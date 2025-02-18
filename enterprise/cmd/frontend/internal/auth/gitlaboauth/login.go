package gitlaboauth

import (
	"net/http"
	"net/url"

	"github.com/dghubble/gologin"
	oauth2Login "github.com/dghubble/gologin/oauth2"
	"golang.org/x/oauth2"

	"github.com/sourcegraph/log"

	"github.com/sourcegraph/sourcegraph/internal/extsvc"
	"github.com/sourcegraph/sourcegraph/internal/extsvc/gitlab"
	"github.com/sourcegraph/sourcegraph/lib/errors"
)

func LoginHandler(config *oauth2.Config, failure http.Handler) http.Handler {
	return oauth2Login.LoginHandler(config, failure)
}

func CallbackHandler(config *oauth2.Config, success, failure http.Handler) http.Handler {
	success = gitlabHandler(config, success, failure)
	return oauth2Login.CallbackHandler(config, success, failure)
}

func gitlabHandler(config *oauth2.Config, success, failure http.Handler) http.Handler {
	logger := log.Scoped("GitlabOAuthHandler", "Gitlab OAuth Handler")

	if failure == nil {
		failure = gologin.DefaultFailureHandler
	}
	fn := func(w http.ResponseWriter, req *http.Request) {
		ctx := req.Context()
		token, err := oauth2Login.TokenFromContext(ctx)
		if err != nil {
			ctx = gologin.WithError(ctx, err)
			failure.ServeHTTP(w, req.WithContext(ctx))
			return
		}

		gitlabClient, err := gitlabClientFromAuthURL(config.Endpoint.AuthURL, token.AccessToken)
		if err != nil {
			ctx = gologin.WithError(ctx, errors.Errorf("could not parse AuthURL %s", config.Endpoint.AuthURL))
			failure.ServeHTTP(w, req.WithContext(ctx))
			return
		}
		user, err := gitlabClient.GetUser(ctx, "")
		err = validateResponse(user, err)
		if err != nil {
			// TODO: Prefer a more general purpose fix, potentially
			// https://github.com/sourcegraph/sourcegraph/pull/20000
			logger.Warn("invalid response", log.Error(err))
		}
		if err != nil {
			ctx = gologin.WithError(ctx, err)
			failure.ServeHTTP(w, req.WithContext(ctx))
			return
		}
		ctx = WithUser(ctx, user)
		success.ServeHTTP(w, req.WithContext(ctx))
	}
	return http.HandlerFunc(fn)
}

// validateResponse returns an error if the given GitLab user or error are unexpected. Returns nil
// if they are valid.
func validateResponse(user *gitlab.User, err error) error {
	if err != nil {
		return errors.Wrap(err, "unable to get GitLab user")
	}
	if user == nil || user.ID == 0 {
		return errors.Errorf("unable to get GitLab user: bad user info %#+v", user)
	}
	return nil
}

func gitlabClientFromAuthURL(authURL, oauthToken string) (*gitlab.Client, error) {
	baseURL, err := url.Parse(authURL)
	if err != nil {
		return nil, err
	}
	baseURL.Path = ""
	baseURL.RawQuery = ""
	baseURL.Fragment = ""
	return gitlab.NewClientProvider(extsvc.URNGitLabOAuth, baseURL, nil, nil).GetOAuthClient(oauthToken), nil
}
