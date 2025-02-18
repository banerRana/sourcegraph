# User authentication (SSO)

Sourcegraph supports the following ways for users to sign in:

- [Guidance](#guidance)
- [Builtin password authentication](#builtin-password-authentication)
- [GitHub](#github)
- [GitLab](#gitlab)
- [SAML](saml/index.md)
- [OpenID Connect](#openid-connect)
  - [Google Workspace (Google accounts)](#google-workspace-google-accounts)
- [HTTP authentication proxies](#http-authentication-proxies)
  - [Username header prefixes](#username-header-prefixes)
- [Username normalization](#username-normalization)
- [Troubleshooting](#troubleshooting)

The authentication provider is configured in the [`auth.providers`](../config/site_config.md#authentication-providers) site configuration option.

## Guidance

If you are unsure which auth provider is right for you, we recommend applying the following rules in
order:

- If you have no external identity providers (i.e., not SSO) or are just trying to spin Sourcegraph
  up as quickly as possible to try, use [`builtin`](#builtin-password-authentication) authentication. You can
  always change the auth configuration later, and user identities from external providers will be
  linked automatically to existing Sourcegraph accounts using verified email addresses.
- If you are deploying Sourcegraph behind a HTTP authentication proxy service, use the
  [`http-header`](#http-authentication-proxies) provider type. The proxy service should handle
  authentication and session management and, in turn, set a HTTP header that indicates the user
  identity to Sourcegraph.
- If you are configuring Sourcegraph to index a GitHub or GitLab instance, we recommend using the
  OAuth provider for that code host. This applies even if the code host itself uses an external
  identity provider (e.g., SAML, OpenID Connect, LDAP, etc.). Sourcegraph will redirect to your code
  host on sign-in and the code host will perform the required sign-in flow before redirecting to
  Sourcegraph on success.
- If you are using an identity provider that supports SAML, use the [SAML auth provider](saml/index.md).
- If you are using an identity provider that supports OpenID Connect (including Google accounts),
  use the [OpenID Connect provider](#openid-connect).
- If you wish to use LDAP and cannot use the GitHub/GitLab OAuth provider as described above, or if
  you wish to use another authentication mechanism that is not yet supported, please [contact
  us](https://github.com/sourcegraph/sourcegraph/issues/new?template=feature_request.md) (we respond
  promptly).

Most users will use only one auth provider, but you can use multiple auth providers if desired to
enable sign-in via multiple services. Identities from different providers will be mapped to a
Sourcegraph user by comparing the user's verified email address to the email address from the
external identity provider.

> _NOTE: If OAuth is the only sign-in method available on sign-out, a new OAuth sign-in will be attempted immediately upon a redirect to the sign-in page. If it is necessary to sign-out and have persistent access to the sign-in page, enable `builtin` sign-in in addition to your OAuth sign-in._

## Builtin password authentication

The [`builtin` auth provider](../config/site_config.md#builtin-password-authentication) manages user accounts internally in its own database. It supports user signup, login, and password reset (via email if configured, or else via a site admin).

Password reset links expire after 4 hours.


###  How to control user sign-up

You can use the filter `allowSignup`, available in the builtin configuration, to control who can create an account in your Sourcegraph instance.

**allowSignup**

  If set to `true`, users will see a sign-up link under the login form and will have access to the sign-up page, where they can create their accounts without restriction.

  When not set, it will default to `false` -- in this case, new user accounts should be created by the site admin.

  If you choose to block sign-ups by using the `allowSignup` filter avaiable in another auth provider (eg., [GitHub](#how-to-control-user-sign-up-and-sign-in-with-github-auth-provider) or [GiLab](#how-to-control-user-sign-up-and-sign-in-with-gitlab-auth-provider)), make sure this builtin filter is removed or set to `false`. Otherwise, users will have a way to bypass the restriction.

  During the initial setup, the builtin sign-up will be available for the first user so they can create an account and become admin.

  ```json
  {
    // ...,
    "auth.providers": [{ "type": "builtin", "allowSignup": true }]
  }
```


### Account lockout

<span class="badge badge-note">Sourcegraph 3.39+</span>

Account will be locked out for 30 minutes after 5 consecutive failed sign-in attempts within one hour for the builtin authentication provider. The threshold and duration of lockout and consecutive periods can be customized via `"auth.lockout"` in the site configuration:

```json
{
  // ...
  "auth.lockout": {
    // The number of seconds to be considered as a consecutive period
    "consecutivePeriod": 3600,
    // The threshold of failed sign-in attempts in a consecutive period
    "failedAttemptThreshold": 5,
    // The number of seconds for the lockout period
    "lockoutPeriod": 1800
  }
}
```

To enabled self-serve account unlock through emails, add the following lines to your site configuration:

```json
{
  // Validity expressed in minutes of the unlock account token
  "auth.unlockAccountLinkExpiry": 30,
  // Base64-encoded HMAC signing key to sign the JWT token for account unlock URLs
  "auth.unlockAccountLinkSigningKey": "your-signing-key",
}
```

The `ssh-keygen` command can be used to generate and encode the signing key, for example:

```bash
$ ssh-keygen -t ed25519 -a 128 -f auth.unlockAccountLinkSigningKey
$ base64 auth.unlockAccountLinkSigningKey | tr -d '\n'
LS0tLS1CRUdJTiBPUEVOU1NIIFBSSVZBVEUgS0VZLS0tLS0KYjNCbGJu...
```

Copy the result of the `base64` command as the value of the `"auth.unlockAccountLinkSigningKey"`.

## GitHub

[Create a GitHub OAuth
application](https://developer.github.com/apps/building-oauth-apps/creating-an-oauth-app/) (if using
GitHub Enterprise, create one on your instance, not GitHub.com). Set the following values, replacing
`sourcegraph.example.com` with the IP or hostname of your Sourcegraph instance:

- Homepage URL: `https://sourcegraph.example.com`
- Authorization callback URL: `https://sourcegraph.example.com/.auth/github/callback`

> NOTE: If you want to enable repository permissions, you should grant your OAuth app permission to
> your GitHub organization(s). You can do that either by creating the OAuth app under your GitHub
> organization (rather than your personal account) or by [following these
> instructions](https://help.github.com/articles/approving-oauth-apps-for-your-organization/).

Then add the following lines to your site configuration:

```json
{
  // ...
  "auth.providers": [
    {
      "type": "github",
      "url": "https://github.example.com",  // URL of your GitHub instance; can leave empty for github.com
      "displayName": "GitHub",
      "clientID": "replace-with-the-oauth-client-id",
      "clientSecret": "replace-with-the-oauth-client-secret",
      "allowSignup": false,  // CAUTION: Set to true to enable signup. If nothing is specified in `allowOrgs` or `allowOrgsMap`, any GitHub user can sign up.
      "allowOrgs": ["your-org-name"], // Restrict logins and sign-ups if enabled to members of these orgs.
      "allowOrgsMap": { "orgName": ["your-team-name"]} // Restrict logins and sign-ups if enabled to members of teams that belong to a given org.
    }
  ]
}
```

Replace the `clientID` and `clientSecret` values with the values from your GitHub OAuth app
configuration.

Leave the `url` field empty for GitHub.com.

Once you've configured GitHub as a sign-on provider, you may also want to [add GitHub repositories to Sourcegraph](../external_service/github.md#repository-syncing).


### How to control user sign-up and sign-in with GitHub auth provider

You can use the following filters to control how users will create accounts and sign in to your Sourcegraph instance via the GitHub auth provider.

**allowSignup**

Set `allowSignup` to `true` to enable anyone with a GitHub account to sign up without invitation (typically done only for GitHub Enterprise).

If set to `false` or not set, sign-up will be blocked. In this case, new users will only be able to sign in after an admin creates their account on Sourcegraph.
The new user email, during their account creation, should match one of their GitHub verified emails.

> WARNING: If `allowSignup` is set to `true`, anyone with internet access to both your Sourcegraph instance and your GitHub url are able to sign up and login to your instance. In particular, if url is set to `https://github.com`, this means that anyone with a Github account could log in to your Sourcegraph instance and search your indexed code. Make sure to also configure the `allowOrgs` field described below to limit sign-ups to your org, or limit public access to your Sourcegraph instance via IP restrictions / VPN. For assistance, contact support.


```json
  {
    "type": "github",
    ...
    "allowSignup": false
  }
```

**allowOrgs**

Restricts sign-ins to members of the listed organizations. If empty or unset, no restriction will be applied.

If combined with `"allowSignup": true`, only membrers of the allowed orgs can create their accounts in Sourcegraph via GitHub authentitcation.

When combined with `"allowSignup": false` or unset, an admin should first create the user account so that the user can sign in with GitHub if they belong to the allowed orgs.

  ```json
    {
      "type": "github",
      // ...
      "allowSignup": true,
      "allowOrgs": ["org1", "org2"]
    },
  ```

**allowOrgsMap**

  Restricts sign-ups and new logins to members of the listed teams or subteams mapped to the organizations they belong to. If empty or unset, no restrictions will be applied.

  When combined with `"allowSignup": true`, only members of the allowed teams can create their accounts in Sourcegraph via GitHub authentication.

  If set with `"allowSignup": false` or if `allowSignup` is unset, an admim should first create the new users accounts so that they can login with GitHub.

  In case both `allowOrgs` and `allowOrgsMap` filters are configured, org membership (`allowOrgs`) will be checked first. Only if the user doesn't belong to any of the listed organizations then team membership (`allowOrgsMap`) will be checked.

  Note that subteams inheritance is not supported — the name of child teams (subteams) should be informed so their members can be granted access to Sourcegraph.

  ```json
    {
       "type": "github",
      // ...
      "allowOrgsMap": {
        "org1": [
          "team1", "subteam1"
        ],
        "org2": [
          "subteam2"
        ]
      }
    }
  ```


## GitLab

[Create a GitLab OAuth application](https://docs.gitlab.com/ee/integration/oauth_provider.html). Set the following values, replacing `sourcegraph.example.com` with the IP or hostname of your
Sourcegraph instance:

- Authorization callback URL: `https://sourcegraph.example.com/.auth/gitlab/callback`
- Scopes: `api`, `read_user`

Then add the following lines to your site configuration:

```json
{
    // ...
    "auth.providers": [
      {
        "type": "gitlab",
        "displayName": "GitLab",
        "clientID": "replace-with-the-oauth-application-id",
        "clientSecret": "replace-with-the-oauth-secret",
        "url": "https://gitlab.example.com",
        "allowSignup": false, // If not set, it defaults to true allowing any GitLab user with access to your instance to sign up.
        "allowGroups": ["group", "group/subgroup", "group/subgroup/subgroup"], // Restrict logins and sign-ups to members of groups or subgroups based on the full-path provided.
      }
    ]
```

Replace the `clientID` and `clientSecret` values with the values from your GitLab OAuth app
configuration.

Once you've configured GitLab as a sign-on provider, you may also want to [add GitLab repositories
to Sourcegraph](../external_service/gitlab.md#repository-syncing).

### How to control user sign-up and sign-in with GitLab auth provider

You can use the following filters to control how users can create accounts and sign in to your Sourcegraph instance via the GitLab auth provider.

**allowSignup**

  Allows anyone with a GitLab account to create their accounts.

  When `false`, sign-up with GitLab will be blocked. In this case, new users can only sign in after an admin creates their account on Sourcegraph. The user account email should match their primary emails on GitLab (which are always verified).

  *If not set, unliked with GitHub, it defaults to `true`, allowing any GitLab user with access to your instance to sign up*.


  ```json
    {
      "type": "gitlab",
      // ...
      "allowSignup": false
    }
  ```

**allowGroups**

  Restricts new sign-ins to members of the listed groups or subgroups.

  Instead of informing the groups or subgroups names, use their full path that can be copied from the URL.

  Example: for a parent group, the full path can be simple as `group`. For nested groups it can look like `group/subgroup/subsubgroup`.

  When empty or unset, no restrictions will be applied.

  If combined with `"allowSignup": false`, an admim should first create the user account so that the user can sign in with GitLab.

  If combined with `"allowSignup": true` or with `allowSignup` unset, only members of  the allowed groups or subgroups can create their accounts in Sourcegraph via GitLab authentitcation.

  ```json
    {
      "type": "gitlab",
      // ...
      "allowSignup": true,
      "allowGroups": [
        "group/subgroup/subsubgroup"
      ]
    }
  ```


## OpenID Connect

The [`openidconnect` auth provider](../config/site_config.md#openid-connect-including-google-workspace) authenticates users via OpenID Connect, which is supported by many external services, including:

- [Google Workspace (Google accounts)](#google-workspace-google-accounts)
- [Okta](https://developer.okta.com/docs/api/resources/oidc.html)
- [Ping Identity](https://www.pingidentity.com/en/resources/client-library/articles/openid-connect.html)
- [Auth0](https://auth0.com/docs/protocols/oidc)
- [Salesforce Identity](https://developer.salesforce.com/page/Inside_OpenID_Connect_on_Force.com)
- [Microsoft Azure Active Directory](https://docs.microsoft.com/en-us/azure/active-directory/develop/active-directory-protocols-openid-connect-code)
- [Google Identity Platform](https://developers.google.com/identity/)
- Known issue: [OneLogin](https://www.onelogin.com/openid-connect) OpenID Connect is not supported (use SAML for OneLogin instead)

To configure Sourcegraph to authenticate users via OpenID Connect:

1. Create a new OpenID Connect client in the external service (such as one of those listed above).
    - **Redirect/callback URI:** `https://sourcegraph.example.com/.auth/callback` (replace `https://sourcegraph.example.com` with the value of the `externalURL` property in your config)
1. Provide the OpenID Connect client's issuer, client ID, and client secret in the Sourcegraph site configuration shown below.
1. (Optional) Require users to have a specific email domain name to authenticate (e.g., to limit users to only those from your organization).

Example [`openidconnect` auth provider](../config/site_config.md#openid-connect-including-google-workspace) configuration:

```json
{
  // ...
  "externalURL": "https://sourcegraph.example.com",
  "auth.providers": [
    {
      "type": "openidconnect",
      "issuer": "https://oidc.example.com",
      "clientID": "my-client-id",
      "configID":"my-config-id" //An arbitrary value that will be used to reference to this auth provider within the site config 
      "clientSecret": "my-client-secret",
      "requireEmailDomain": "example.com"
    }
  ]
}
```

Sourcegraph supports the OpenID Connect Discovery standard for configuring the auth provider (using the document at, e.g., `https://oidc.example.com/.well-known/openid-configuration`).

See the [`openid` auth provider documentation](../config/site_config.md#openid-connect-including-google-workspace) for the full set of configuration options.

### How to control user sign-up with OpenID auth provider

**allowSignup**

  If true or not set, it allows new users to creating their Sourcegraph accounts via OpenID.
  When `false`, sing-up won't be available and a site admin should create new users accounts.

  ```json
    {
      "type": "openidconnect",
      // ...
      "allowSignup": false
    }
  ```

### Google Workspace (Google accounts)

Google's Workspace (formerly known as G Suite) supports OpenID Connect, which is the best way to enable Sourcegraph authentication using Google accounts. To set it up:

1. Create an **OAuth client ID** and client secret in the [Google API credentials console](https://console.developers.google.com/apis/credentials). [Google's interactive OpenID Connect documentation page](https://developers.google.com/identity/protocols/OpenIDConnect#getcredentials):
    - **Application type:** Web application
    - **Name:** Sourcegraph (or any other name your users will recognize)
    - **Authorized JavaScript origins:** (leave blank)
    - **Authorized redirect URIs:** `https://sourcegraph.example.com/.auth/callback` (replace `https://sourcegraph.example.com` with the value of the `externalURL` property in your config)
1. Use the **client ID** and **client secret** values in Sourcegraph site configuration (as shown in the example below).
1. Set your Google Workspace domain in `requireEmailDomain` to prevent users outside your organization from signing in.

Example [`openidconnect` auth provider](../config/site_config.md#openid-connect-including-google-workspace) configuration for Google Workspace:

```json
{
  // ...
  "externalURL": "https://sourcegraph.example.com",
  "auth.providers": [
    {
      "type": "openidconnect",
      "issuer": "https://accounts.google.com", // All Google Workspace domains use this issuer URI.
      "clientID": "my-client-id",
      "clientSecret": "my-client-secret",
      "requireEmailDomain": "example.com"
    }
  ]
}
```

## HTTP authentication proxies

You can wrap Sourcegraph in an authentication proxy that authenticates the user and passes the user's username or email (or both) to Sourcegraph via HTTP headers. The most popular such authentication proxy is [pusher/oauth2_proxy](https://github.com/pusher/oauth2_proxy). Another example is [Google Identity-Aware Proxy (IAP)](https://cloud.google.com/iap/). Both work well with Sourcegraph.

To use an authentication proxy to authenticate users to Sourcegraph, add the following lines to your site configuration:

```json
{
  // ...
  "auth.providers": [
    {
      "type": "http-header",
      "usernameHeader": "X-Forwarded-User",
      "emailHeader": "X-Forwarded-Email"
    }
  ]
}
```

Replace `X-Forwarded-User` with the name of the HTTP header added by the authentication proxy that contains the user's username.

Ensure that the HTTP proxy is not setting its own `Authorization` header on the request. Sourcegraph rejects requests with unrecognized `Authorization` headers and prints the error log `lvl=eror msg="Invalid Authorization header." err="unrecognized HTTP Authorization request header scheme (supported values: token, token-sudo)"`.

For pusher/oauth2_proxy, use the `-pass-basic-auth false` option to prevent it from sending the `Authorization` header.

### Username header prefixes

Some proxies add a prefix to the username header value. For example, Google IAP sets the `x-goog-authenticated-user-id` to a value like `accounts.google.com:alice` rather than just `alice`. If this is the case, use the `stripUsernameHeaderPrefix` field. If using Google IAP, for example, add the following lines to your site configuration:

```json
{
  // ...
  "auth.providers": [
    {
      "type": "http-header",
      "usernameHeader": "x-goog-authenticated-user-email",
      "stripUsernameHeaderPrefix": "accounts.google.com:"
    }
  ]
}
```

## Linking a Sourcegraph account to an auth provider

In most cases, the link between a Sourcegraph account and an authentication provider account happens via email.

Consequently, you can only sign in via an auth provider if your email on Sourcegraph matches the one configured in the auth provider.

Let's say the email field in your Sourcegraph account was kept blank when a site admin created the account for you, but the username matches your username on GitHub or GitLab. Will this work? If you try to sign in to SG with GitHub or GitLab, it won't work, and you will see an error informing you that a verified email is missing.

Exceptions to this rule are [HTTP Proxies](#http-authentication-proxies), where there's an option to make the link via username only.
For [Bitbucket](../config/authorization_and_authentication.md#bitbucket-server-bitbucket-data-center-authorization), we don't support OAuth. Still, the match between the chosen auth provider used with Bitbucket and a user's Bitbucket account happens via username.

Using only a username to match a Sourcegraph account to an auth provider account is not recommended, as you can see [here](../repo/permissions.md#username), for example.
Usernames in Sourcegraph are mutable, so a malicious user could change a username, elevating their privileges.

## Linking accounts from multiple auth providers
Sourcegraph will automatically link accounts from multiple external auth providers, resulting in a single user account on Sourcegraph. That way a user can login with multiple auth methods and end up being logged in with the same Sourcegraph account. In general, to link accounts, the following condition needs to be met:

At the time of signing in with the new account, any of the email addresses configured on the user account on the auth provider must match any of the **verified** email addresses on the user account on the Sourcegraph side. If there is a match, the accounts are linked, [otherwise a new user account is created if auth provider is configured to support user sign ups](#how-to-control-user-sign-up).

## Username normalization

Usernames on Sourcegraph are normalized according to the following rules.

- Any characters not in `[a-zA-Z0-9-.]` are replaced with `-`
- Usernames with exactly one `@` character are interpreted as an email address, so the username will be extracted by truncating at the `@` character.
- Usernames with two or more `@` characters are not considered an email address, so the `@` will be treated as a non-standard character and be replaced with `-`
- Usernames with consecutive `-` or `.` characters are not allowed
- Usernames that start or end with `.` are not allowed
- Usernames that start with `-` are not allowed

Usernames from authentication providers are normalized before being used in Sourcegraph. Usernames chosen by users are rejected if they do not meet these criteria.

For example, a user whose external username (according the authentication provider) is `alice_smith@example.com` would have the Sourcegraph username `alice-smith`.

If multiple accounts normalize into the same username, only the first user account is created. Other users won't be able to sign in. This is a rare occurrence; contact support if this is a blocker.

## [Troubleshooting](troubleshooting.md)
