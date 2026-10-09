# College Google sign-in

Normal email/password login is the default and accepts Gmail or any valid email address. It needs no Google Cloud access, college domain, OTP, or email sender. Use `AUTH_MODE=password`. The instructions below apply only to optional `AUTH_MODE=google`.

The login screen uses Google's hosted account chooser and sign-in page. Users enter their Google password only on Google. CampusRelay exchanges a one-time authorization code on the server with PKCE and a session-bound, expiring state value, then retrieves the verified identity from Google's HTTPS UserInfo endpoint. Both the verified email suffix and Workspace `hd` domain must match `srishakthi.ac.in`.

## One-time Google Cloud configuration

1. In the college's Google Cloud project, configure the OAuth consent screen for the college organization. Request only OpenID, email and profile. If the app remains in external testing, add the intended test users in Google Cloud.
2. Create an OAuth client of type **Web application**.
3. Add this exact local authorized redirect URI: `http://127.0.0.1:5173/api/auth/google/callback`. The Vite proxy forwards `/api` requests to Express. Always open the app using the same hostname as this URI.
4. Set the variables below in the server environment. Keep the client secret out of source control and chat. `.env.example` documents the variables; this project does not automatically load `.env` files.

```powershell
$env:AUTH_MODE = "google"
$env:COLLEGE_EMAIL_DOMAINS = "srishakthi.ac.in"
$env:APP_URL = "http://127.0.0.1:5173"
$env:GOOGLE_CLIENT_ID = "YOUR_GOOGLE_WEB_CLIENT_ID"
$env:GOOGLE_CLIENT_SECRET = "YOUR_GOOGLE_CLIENT_SECRET"
npm.cmd run dev
```

For a production or single-server deployment, set `APP_URL` to that application's public origin and register its exact `/api/auth/google/callback` URL in Google Cloud. Production requires HTTPS and a strong session secret. Stop the previous local server before running another copy.

## Roles and first-time users

- A verified college student can create an account by signing in to the Student portal, if college registration is open. New accounts receive Whole College membership and no self-assigned academic year.
- An administrator must provision faculty accounts with their exact college email before first Google sign-in. Use the existing admin users screen to create users and assign academic years. Provision the first administrator with `npm run create-admin` using that administrator's college email; the generated local password is not used by Google sign-in.
- Choosing a portal does not change the account's assigned role. A mismatch returns an actionable error to the chosen portal.
- Public password registration and local-password login endpoints are blocked in the default Google mode. Existing local sessions lose access until Google sign-in. Existing records are preserved.
- Google subject identifiers are bound to account IDs. A different Google subject cannot silently replace an established identity.

For isolated development only, `AUTH_MODE=local` exposes the local CampusRelay email/password form. It does not verify college Google identity. Automated tests use isolated local accounts and mocked Google responses; they do not authenticate against the real college Google tenant. No trial-account buttons are displayed in either mode.

Live verification requires valid OAuth credentials and a real college Google account. A non-Google college mailbox cannot sign in through this integration.

Reference: [Google server-side authentication flow](https://developers.google.com/identity/openid-connect/openid-connect).
