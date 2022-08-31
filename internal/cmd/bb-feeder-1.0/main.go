package main

import (
	"context"
	"flag"
	"fmt"
	bbv1 "github.com/gfleury/go-bitbucket-v1"
	"github.com/inconshreveable/log15"
	"github.com/mitchellh/mapstructure"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/schollz/progressbar/v3"
	"github.com/sourcegraph/sourcegraph/internal/ratelimit"
	"golang.org/x/time/rate"
	"log"
	"math"
	"net/http"
	"net/url"
	"os/signal"
	"path/filepath"
	"strconv"
	"sync"

	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"os"
)

var (
	reposProcessedCounter = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "bb_feeder_processed",
		Help: "The total number of processed repos (labels: worker)",
	}, []string{"worker"})
	reposFailedCounter = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "bb_feeder_failed",
		Help: "The total number of failed repos (labels: worker, err_type with values {clone, api, push, unknown}",
	}, []string{"worker", "err_type"})
	reposSucceededCounter = promauto.NewCounter(prometheus.CounterOpts{
		Name: "bb_feeder_succeeded",
		Help: "The total number of succeeded repos",
	})
	reposAlreadyDoneCounter = promauto.NewCounter(prometheus.CounterOpts{
		Name: "bb_feeder_skipped",
		Help: "The total number of repos already done in previous runs (found in feeder.database)",
	})

	remainingWorkGauge = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "bb_feeder_remaining_work",
		Help: "The number of repos that still need to be processed from the specified input",
	})
)

/*
Sample program arguments:
-admin <your bitbucket user>
-password  <your bitbucket user's password>
-baseURL http://ec2-54-187-175-80.us-west-2.compute.amazonaws.com/
-deleteProjects=false
-numSimultaneousPushes 1
-numSimultaneousClones 1
-numWorkers 1
-cloneRepoTimeout 1h
-scratchDir clones
./internal/cmd/bb-feeder-1.0/repos.txt
*/
func main() {
	admin := flag.String("admin", "", "(required) destination bb admin name")
	token := flag.String("token", os.Getenv("BITBUCKET_TOKEN"), "(required) Bitbucket personal access token for the destination BB instance")
	password := flag.String("password", "", "password for the Bitbucket user identified by the admin flag")
	baseURL := flag.String("baseURL", "", "(required) Bitbucket Base URL e.g. https://bitbucket.sgdev.org/")
	deleteProjects := flag.Bool("deleteProjects", false, "(optional) delete admin user's projects (and their repositories) before proceeding with creating new projects and repositories")
	progressFilepath := flag.String("progress", "feeder.database", "path to a sqlite DB recording the progress made in the feeder (created if it doesn't exist)")
	uploadURL := flag.String("uploadURL", "", "upload URL of bb instance to feed")
	numWorkers := flag.Int("numWorkers", 20, "number of workers")
	scratchDir := flag.String("scratchDir", "", "scratch dir where to temporarily clone repositories")
	limitPump := flag.Int64("limit", math.MaxInt64, "limit processing to this many repos (for debugging)")
	skipNumLines := flag.Int64("skip", 0, "skip this many lines from input")
	logFilepath := flag.String("logfile", "feeder.log", "path to a log file")
	apiCallsPerSec := flag.Float64("apiCallsPerSec", 100.0, "how many API calls per sec to destination bb")
	numSimultaneousPushes := flag.Int("numSimultaneousPushes", 10, "number of simultaneous bb pushes")
	cloneRepoTimeout := flag.Duration("cloneRepoTimeout", time.Minute*3, "how long to wait for a repo to clone")
	numCloningAttempts := flag.Int("numCloningAttempts", 5, "number of cloning attempts before giving up")
	numSimultaneousClones := flag.Int("numSimultaneousClones", 10, "number of simultaneous github.com clones")
	groupName := flag.String("groupName", "", "name of bitbucket group to create and grant project read access to")
	help := flag.Bool("help", false, "Show help")

	flag.Parse()

	logHandler, err := log15.FileHandler(*logFilepath, log15.LogfmtFormat())
	if err != nil {
		log.Fatal(err)
	}
	log15.Root().SetHandler(logHandler)

	if *help || len(*baseURL) == 0 || len(*token) == 0 || len(*admin) == 0 {
		flag.PrintDefaults()
		os.Exit(0)
	}

	if len(*uploadURL) == 0 {
		*uploadURL = *baseURL
	}

	if len(*groupName) == 0 {
		*groupName = "groupCreated_" + strconv.FormatInt(time.Now().UnixMilli(), 10)
	}

	if len(*scratchDir) == 0 {
		d, err := os.MkdirTemp("", "bb-feeder")
		if err != nil {
			log15.Error("failed to create scratch dir", "error", err)
			os.Exit(1)
		}
		*scratchDir = d
	}

	u, err := url.Parse(*baseURL)
	if err != nil {
		log15.Error("failed to parse base URL", "baseURL", *baseURL, "error", err)
		os.Exit(1)
	}
	host := u.Host

	ctx := context.Background()

	//// Token Auth
	//// Note that Token Auth cannot create Projects
	//ctx = context.WithValue(ctx, bbv1.ContextAccessToken, *token)

	// Basic Auth
	basicAuth := bbv1.BasicAuth{UserName: *admin, Password: *password}
	ctx = context.WithValue(ctx, bbv1.ContextBasicAuth, basicAuth)

	client := bbv1.NewAPIClient(
		ctx,
		bbv1.NewConfiguration(*baseURL+"/rest"),
	)

	// delete bitbucket projects and repos for the admin user
	// repositories not associated with a project key are not deleted
	// Note that we require BasicAuth for project creation and deletion
	if *deleteProjects {
		clearAllProjects(client, *admin)
		err := os.Remove(*progressFilepath)
		if err != nil && !os.IsNotExist(err) {
			log15.Error("failed to remove feeder database file", "progressFilepath", *progressFilepath, "error", err)
			os.Exit(1)
		}
	}

	// TODO Delete previous bb groups
	groupVars := map[string]interface{}{"name": *groupName}
	resp, err := client.DefaultApi.CreateGroup(groupVars)
	if err != nil {
		log15.Error("failed to create group", "group", *groupName, "error", err, "status", resp.StatusCode)
		os.Exit(1)
	}

	fdr, err := newFeederDB(*progressFilepath)
	if err != nil {
		log15.Error("failed to create sqlite DB", "path", *progressFilepath, "error", err)
		os.Exit(1)
	}

	spinner := progressbar.Default(-1, "calculating work")
	numLines, err := numLinesTotal(*skipNumLines)
	if err != nil {
		log15.Error("failed to calculate outstanding work", "error", err)
		os.Exit(1)
	}
	_ = spinner.Finish()

	if numLines > *limitPump {
		numLines = *limitPump
	}

	if numLines == 0 {
		log15.Info("no work remaining in input")
		fmt.Println("no work remaining in input, exiting")
		os.Exit(0)
	}

	remainingWorkGauge.Set(float64(numLines))
	bar := progressbar.New64(numLines)

	work := make(chan string)

	prdc := &producer{
		remaining:    numLines,
		pipe:         work,
		fdr:          fdr,
		logger:       log15.New("source", "producer"),
		bar:          bar,
		skipNumLines: *skipNumLines,
	}

	var wg sync.WaitGroup

	wg.Add(*numWorkers)

	// trap Ctrl+C and call cancel on the context
	ctx, cancel := context.WithCancel(ctx)
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt)
	defer func() {
		signal.Stop(c)
		cancel()
	}()
	go func() {
		select {
		case <-c:
			cancel()
		case <-ctx.Done():
		}
	}()

	go func() {
		http.Handle("/metrics", promhttp.Handler())
		_ = http.ListenAndServe(":2112", nil)
	}()

	rateLimiter := ratelimit.NewInstrumentedLimiter("bbFeeder", rate.NewLimiter(rate.Limit(*apiCallsPerSec), 100))
	pushSem := make(chan struct{}, *numSimultaneousPushes)
	cloneSem := make(chan struct{}, *numSimultaneousClones)

	var wkrs []*worker

	for i := 0; i < *numWorkers; i++ {
		name := fmt.Sprintf("worker-%d", i)
		wkrScratchDir := filepath.Join(*scratchDir, name)
		err := os.MkdirAll(wkrScratchDir, 0777)
		if err != nil {
			log15.Error("failed to create worker scratch dir", "scratchDir", *scratchDir, "error", err)
			os.Exit(1)
		}
		wkr := &worker{
			name:               name,
			client:             client,
			index:              i,
			scratchDir:         wkrScratchDir,
			work:               work,
			wg:                 &wg,
			bar:                bar,
			fdr:                fdr,
			logger:             log15.New("source", name),
			rateLimiter:        rateLimiter,
			admin:              *admin,
			token:              *token,
			host:               host,
			pushSem:            pushSem,
			cloneSem:           cloneSem,
			cloneRepoTimeout:   *cloneRepoTimeout,
			numCloningAttempts: *numCloningAttempts,
			groupName:          *groupName,
		}
		wkrs = append(wkrs, wkr)
		go wkr.run(ctx)
	}

	err = prdc.pump(ctx)
	if err != nil {
		log15.Error("pump failed", "error", err)
		os.Exit(1)
	}
	close(work)
	wg.Wait()
	_ = bar.Finish()

	s := stats(wkrs, prdc)

	fmt.Println(s)
	log15.Info(s)
}

func stats(wkrs []*worker, prdc *producer) string {
	var numProcessed, numSucceeded, numFailed int64

	for _, wkr := range wkrs {
		numProcessed += wkr.numSucceeded + wkr.numFailed
		numFailed += wkr.numFailed
		numSucceeded += wkr.numSucceeded
	}

	return fmt.Sprintf("\n\nDone: processed %d, succeeded: %d, failed: %d, skipped: %d\n",
		numProcessed, numSucceeded, numFailed, prdc.numAlreadyDone)
}

func clearAllProjects(client *bbv1.APIClient, user string) {
	resp, err := client.DefaultApi.GetProjects(nil)
	if err != nil {
		log15.Error("failed to obtain projects for user", "user", user, "error", err)
		os.Exit(1)
	}
	var projs []bbv1.Project
	err = mapstructure.Decode(resp.Values["values"], &projs)

	for _, proj := range projs {
		if proj.Key == "STAT" {
			continue
		}
		resp, err = client.DefaultApi.GetRepositories(proj.Key)
		repos, err := bbv1.GetRepositoriesResponse(resp)
		for _, repo := range repos {
			resp, err = client.DefaultApi.DeleteRepository(proj.Key, repo.Slug)
			if err != nil {
				log15.Error("failed to delete repository", "user", user, "project", proj.Key, "repo", repo.Slug, "error", err)
				os.Exit(1)
			}
		}
		resp, err = client.DefaultApi.DeleteProject(proj.Key)
		if err != nil && err.Error() != "EOF" && resp != nil {
			log15.Error("failed to delete project for user", "user", user, "project", proj.Key, "error", err)
			os.Exit(1)
		}
	}
}
