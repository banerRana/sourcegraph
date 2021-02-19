package httpapi

import (
	"github.com/gorilla/mux"

	"github.com/sourcegraph/sourcegraph/cmd/frontend/enterprise"
	"github.com/sourcegraph/sourcegraph/cmd/frontend/internal/httpapi/router"
	"github.com/sourcegraph/sourcegraph/internal/database/dbtesting"
	"github.com/sourcegraph/sourcegraph/internal/httptestutil"
	"github.com/sourcegraph/sourcegraph/internal/txemail"
)

func init() {
	txemail.DisableSilently()
}

func newTest() *httptestutil.Client {
	enterpriseServices := enterprise.DefaultServices()
	db := new(dbtesting.MockDB)

	return httptestutil.NewTest(NewHandler(db,
		router.New(mux.NewRouter()),
		nil,
		enterpriseServices.GitHubWebhook,
		enterpriseServices.GitLabWebhook,
		enterpriseServices.BitbucketServerWebhook,
		enterpriseServices.NewCodeIntelUploadHandler,
	))
}
