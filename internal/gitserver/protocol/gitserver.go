package protocol

import (
	"encoding/json"
	"time"

	"github.com/opentracing/opentracing-go/log"

	"github.com/sourcegraph/sourcegraph/internal/api"
	"github.com/sourcegraph/sourcegraph/internal/gitserver/gitdomain"
	"github.com/sourcegraph/sourcegraph/internal/search/result"
	"github.com/sourcegraph/sourcegraph/lib/errors"
)

type SearchRequest struct {
	Repo                 api.RepoName
	Revisions            []RevisionSpecifier
	Query                Node
	IncludeDiff          bool
	Limit                int
	IncludeModifiedFiles bool
}

type RevisionSpecifier struct {
	// RevSpec is a revision range specifier suitable for passing to git. See
	// the manpage gitrevisions(7).
	RevSpec string

	// RefGlob is a reference glob to pass to git. See the documentation for
	// "--glob" in git-log.
	RefGlob string

	// ExcludeRefGlob is a glob for references to exclude. See the
	// documentation for "--exclude" in git-log.
	ExcludeRefGlob string
}

type SearchEventMatches []CommitMatch

type SearchEventDone struct {
	LimitHit bool
	Error    string
}

func (s SearchEventDone) Err() error {
	if s.Error != "" {
		var e gitdomain.RepoNotExistError
		if err := json.Unmarshal([]byte(s.Error), &e); err != nil {
			return &e
		}
		return errors.New(s.Error)
	}
	return nil
}

func NewSearchEventDone(limitHit bool, err error) SearchEventDone {
	event := SearchEventDone{
		LimitHit: limitHit,
	}
	var notExistError *gitdomain.RepoNotExistError
	if errors.As(err, &notExistError) {
		b, _ := json.Marshal(notExistError)
		event.Error = string(b)
	} else if err != nil {
		event.Error = err.Error()
	}
	return event
}

type CommitMatch struct {
	Oid        api.CommitID
	Author     Signature      `json:",omitempty"`
	Committer  Signature      `json:",omitempty"`
	Parents    []api.CommitID `json:",omitempty"`
	Refs       []string       `json:",omitempty"`
	SourceRefs []string       `json:",omitempty"`

	Message       result.MatchedString `json:",omitempty"`
	Diff          result.MatchedString `json:",omitempty"`
	ModifiedFiles []string             `json:",omitempty"`
}

type Signature struct {
	Name  string `json:",omitempty"`
	Email string `json:",omitempty"`
	Date  time.Time
}

// ExecRequest is a request to execute a command inside a git repository.
//
// Note that this request is deserialized by both gitserver and the frontend's
// internal proxy route and any major change to this structure will need to
// be reconciled in both places.
type ExecRequest struct {
	Repo api.RepoName `json:"repo"`

	EnsureRevision string      `json:"ensureRevision"`
	Args           []string    `json:"args"`
	Opt            *RemoteOpts `json:"opt"`
	NoTimeout      bool        `json:"noTimeout"`
}

// BatchLogRequest is a request to execute a `git log` command inside a set of
// git repositories present on the target shard.
type BatchLogRequest struct {
	RepoCommits []api.RepoCommit `json:"repoCommits"`

	// Format is the entire `--format=<format>` argument to git log. This value
	// is expected to be non-empty.
	Format string `json:"format"`
}

func (req BatchLogRequest) LogFields() []log.Field {
	return []log.Field{
		log.Int("numRepoCommits", len(req.RepoCommits)),
		log.String("format", req.Format),
	}
}

type BatchLogResponse struct {
	Results []BatchLogResult `json:"results"`
}

// BatchLogResult associates a repository and commit pair from the input of a BatchLog
// request with the result of the associated git log command.
type BatchLogResult struct {
	RepoCommit    api.RepoCommit `json:"repoCommit"`
	CommandOutput string         `json:"output"`
	CommandError  string         `json:"error,omitempty"`
}

// P4ExecRequest is a request to execute a p4 command with given arguments.
//
// Note that this request is deserialized by both gitserver and the frontend's
// internal proxy route and any major change to this structure will need to be
// reconciled in both places.
type P4ExecRequest struct {
	P4Port   string   `json:"p4port"`
	P4User   string   `json:"p4user"`
	P4Passwd string   `json:"p4passwd"`
	Args     []string `json:"args"`
}

// RemoteOpts configures interactions with a remote repository.
type RemoteOpts struct {
	SSH   *SSHConfig   `json:"ssh"`   // SSH configuration for communication with the remote
	HTTPS *HTTPSConfig `json:"https"` // HTTPS configuration for communication with the remote
}

// SSHConfig configures and authenticates SSH for communication with remotes.
type SSHConfig struct {
	User       string `json:"user,omitempty"`      // SSH user (if empty, inferred from URL)
	PublicKey  []byte `json:"publicKey,omitempty"` // SSH public key (if nil, inferred from PrivateKey)
	PrivateKey []byte `json:"privateKey"`          // SSH private key, usually passed to ssh.ParsePrivateKey (passphrases currently unsupported)
}

// HTTPSConfig configures and authenticates HTTPS for communication with remotes.
type HTTPSConfig struct {
	User string `json:"user"` // the username provided to the remote
	Pass string `json:"pass"` // the password provided to the remote
}

// RepoUpdateRequest is a request to update the contents of a given repo, or clone it if it doesn't exist.
type RepoUpdateRequest struct {
	Repo  api.RepoName  `json:"repo"`  // identifying URL for repo
	Since time.Duration `json:"since"` // debounce interval for queries, used only with request-repo-update

	// CloneFromShard is the hostname of the gitserver instance that is the current owner of the
	// repository. If this is set, then the RepoUpdateRequest is to migrate the repo from
	// that gitserver instance to the new home of the repo.
	CloneFromShard string `json:"cloneFromShard"`
}

// RepoUpdateResponse returns meta information of the repo enqueued for update.
type RepoUpdateResponse struct {
	LastFetched *time.Time `json:",omitempty"`
	LastChanged *time.Time `json:",omitempty"`

	// Error is an error reported by the update operation, and not a network protocol error.
	Error string `json:",omitempty"`
}

// RepoCloneRequest is a request to clone a repository asynchronously.
type RepoCloneRequest struct {
	Repo api.RepoName `json:"repo"`
}

// RepoCloneResponse returns an error if the repo clone request failed.
type RepoCloneResponse struct {
	Error string `json:",omitempty"`
}

type NotFoundPayload struct {
	CloneInProgress bool `json:"cloneInProgress"` // If true, exec returned with noop because clone is in progress.

	// CloneProgress is a progress message from the running clone command.
	CloneProgress string `json:"cloneProgress,omitempty"`
}

// IsRepoCloneableRequest is a request to determine if a repo is cloneable.
type IsRepoCloneableRequest struct {
	// Repo is the repository to check.
	Repo api.RepoName `json:"Repo"`
}

// IsRepoCloneableResponse is the response type for the IsRepoCloneableRequest.
type IsRepoCloneableResponse struct {
	Cloneable bool   // whether the repo is cloneable
	Reason    string // if not cloneable, the reason why not
}

// RepoDeleteRequest is a request to delete a repository clone on gitserver
type RepoDeleteRequest struct {
	// Repo is the repository to delete.
	Repo api.RepoName
}

// ReposStats is an aggregation of statistics from a gitserver.
type ReposStats struct {
	// UpdatedAt is the time these statistics were computed. If UpdateAt is
	// zero, the statistics have not yet been computed. This can happen on a
	// new gitserver.
	UpdatedAt time.Time

	// GitDirBytes is the amount of bytes stored in .git directories.
	GitDirBytes int64
}

// RepoCloneProgressRequest is a request for information about the clone progress of multiple
// repositories on gitserver.
type RepoCloneProgressRequest struct {
	Repos []api.RepoName
}

// RepoCloneProgress is information about the clone progress of a repo
type RepoCloneProgress struct {
	CloneInProgress bool   // whether the repository is currently being cloned
	CloneProgress   string // a progress message from the running clone command.
	Cloned          bool   // whether the repository has been cloned successfully
}

// RepoCloneProgressResponse is the response to a repository clone progress request
// for multiple repositories at the same time.
type RepoCloneProgressResponse struct {
	Results map[api.RepoName]*RepoCloneProgress
}

// CreateCommitFromPatchRequest is the request information needed for creating
// the simulated staging area git object for a repo.
type CreateCommitFromPatchRequest struct {
	// Repo is the repository to get information about.
	Repo api.RepoName
	// BaseCommit is the revision that the staging area object is based on
	BaseCommit api.CommitID
	// Patch is the diff contents to be used to create the staging area revision
	Patch string
	// TargetRef is the ref that will be created for this patch
	TargetRef string
	// If set to true and the TargetRef already exists, an unique number will be appended to the end (ie TargetRef-{#}). The generated ref will be returned.
	UniqueRef bool
	// CommitInfo is the information that will be used when creating the commit from a patch
	CommitInfo PatchCommitInfo
	// Push specifies whether the target ref will be pushed to the code host: if
	// nil, no push will be attempted, if non-nil, a push will be attempted.
	Push *PushConfig
	// GitApplyArgs are the arguments that will be passed to `git apply` along
	// with `--cached`.
	GitApplyArgs []string
}

// PatchCommitInfo will be used for commit information when creating a commit from a patch
type PatchCommitInfo struct {
	Message        string
	AuthorName     string
	AuthorEmail    string
	CommitterName  string
	CommitterEmail string
	Date           time.Time
}

// PushConfig provides the configuration required to push one or more commits to
// a code host.
type PushConfig struct {
	// RemoteURL is the git remote URL to which to push the commits.
	// The URL needs to include HTTP basic auth credentials if no
	// unauthenticated requests are allowed by the remote host.
	RemoteURL string

	// PrivateKey is used when the remote URL uses scheme `ssh`. If set,
	// this value is used as the content of the private key. Needs to be
	// set in conjunction with a passphrase.
	PrivateKey string

	// Passphrase is the passphrase to decrypt the private key. It is required
	// when passing PrivateKey.
	Passphrase string
}

// CreateCommitFromPatchResponse is the response type returned after creating
// a commit from a patch
type CreateCommitFromPatchResponse struct {
	// Rev is the tag that the staging object can be found at
	Rev string

	// Error is populated only on error
	Error *CreateCommitFromPatchError
}

// SetError adds the supplied error related details to e.
func (e *CreateCommitFromPatchResponse) SetError(repo, command, out string, err error) {
	if e.Error == nil {
		e.Error = &CreateCommitFromPatchError{}
	}
	e.Error.RepositoryName = repo
	e.Error.Command = command
	e.Error.CombinedOutput = out
	e.Error.InternalError = err.Error()
}

// CreateCommitFromPatchError is populated on errors running
// CreateCommitFromPatch
type CreateCommitFromPatchError struct {
	// RepositoryName is the name of the repository
	RepositoryName string

	// InternalError is the internal error
	InternalError string

	// Command is the last git command that was attempted
	Command string
	// CombinedOutput is the combined stderr and stdout from running the command
	CombinedOutput string
}

// Error returns a detailed error conforming to the error interface
func (e *CreateCommitFromPatchError) Error() string {
	return e.InternalError
}

type GetObjectRequest struct {
	Repo       api.RepoName
	ObjectName string
}

type GetObjectResponse struct {
	Object gitdomain.GitObject
}
