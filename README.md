# CampusRelay

CampusRelay is a multi-user college circular system. Faculty send one circular to one or more groups, and students see it only when their persisted SQLite memberships match at least one target.

CampusRelay uses React, React Router, TanStack Query, Vite, Express, SQLite, bcrypt sessions, and Socket.IO. It preserves the original phone-shell interface while replacing manual DOM screen toggling with real routes.

**Live app:** [CampusRelay on Railway](https://notifycircular-copy-production.up.railway.app/)

For a guided demonstration, see the [project review walkthrough](docs/PROJECT_REVIEW.md).

Academic communities follow Year → Department → Section. Assigned faculty can create subjects and share downloadable study materials. See [class setup and materials](docs/CLASS_MATERIALS.md) for administrator and staff instructions.

## Run it

Requires Node.js 20.19 or newer; the production Docker image uses Node.js 22. Set configuration in the server environment using [.env.example](.env.example) as a reference. The project does not automatically load `.env` files.

```powershell
npm.cmd install
npm.cmd run dev
```

Development URLs:

- React/Vite: [http://127.0.0.1:5173](http://127.0.0.1:5173)
- Express API: [http://127.0.0.1:3000](http://127.0.0.1:3000)

For the production build and single-server mode:

```powershell
$env:SESSION_SECRET = "local-demo-session-secret-at-least-32-characters"
npm.cmd run build
npm.cmd start
```

`npm run build` creates the React client artifact. `npm start` then serves that existing build and the API at [http://127.0.0.1:3000](http://127.0.0.1:3000), without requiring Vite in the runtime dependency set. SQLite data lives in `data/notify-circular.db` and survives restarts.

Run every automated check with:

```powershell
npm.cmd run verify
```

This runs TypeScript checking, the API and React component suites, builds the client, and runs Playwright against a dedicated in-memory server on port 3100. The browser tests never read or modify `data/notify-circular.db`.

## Sign-in and account roles

First visits open the login screen. Select Student or Faculty and sign in with your email and CampusRelay password. Gmail and other valid email addresses are accepted. No OTP, email sender, or Google Cloud setup is required in the default `AUTH_MODE=password` mode. New students choose **New student? Create an account**, complete the student details listed below, and create a password of at least eight characters. Do not enter your Gmail password.

Faculty can choose **New faculty? Create an account** in the Faculty portal to register with an email and CampusRelay password. Faculty registration in normal password mode grants faculty access immediately. Administrator accounts must still be provisioned. Existing accounts cannot switch roles by selecting another portal. Signed-in users opening the home page or another role’s portal return automatically to their own portal. Students open their inbox, faculty open Compose, and administrators open their dashboard. The signed-in portal chooser and automatic faculty demo are removed. Existing account passwords continue to work. Email ownership is not verified in normal password mode. Optional college OTP uses `AUTH_MODE=college`; optional Google sign-in uses `AUTH_MODE=google`.

## Implemented features


- Inbox discovery combines group, received-date and status filters with newest, oldest or priority sorting. Result counts and one-click reset make active filters clear; selections survive refresh and returning from a circular.
- Campus search, topic and collection filters stay in the URL for refresh and browser navigation. Publishing from a focused post returns to the full feed so the new post is visible.
- **Preferences → Personalize your workspace** offers Aurora violet, Ocean teal and Rose berry accents, comfortable or compact cards, and reduced motion. Choices save automatically in the current browser and work with light/dark appearance.

- Indigo, lavender and coral **Aurora Pulse** theme in light and dark modes, with theme controls inside both portals, soft background glows, hover feedback, and reduced-motion support.
- Post topics: Campus life, Achievements, Events, Opportunities, and Questions. Topics work with search, saved collections, and personal posts; existing posts keep their content during the automatic database migration.
- Student **Events** tab: upcoming dates and deadlines from authorized circulars, sorted by date, with links to the notice and calendar download.
- **Mark all as read** clears unread status across the student's inbox while preserving required acknowledgments as separate actions.
- Faculty can search their latest 100 sent or received circulars by message, faculty, or group.

- Campus discovery: search post captions or author names across the entire feed, keep a private **Saved** collection, filter to **My posts**, and edit your own captions without losing reactions.
- Student notice search by message, group, or faculty, plus **Urgent** and **Needs action** filters and a pending acknowledgment shortcut.
- Responsive workspace: desktop sidebar navigation and wider content, mobile bottom tabs, clearer search fields, and contextual empty states.

- Shared **Campus** feed in both portals: all signed-in students and faculty can publish college updates and achievements, attach one JPEG/PNG/WebP photo (up to 2 MB), like posts, and comment. Authors can delete their own posts. Posts, photos, likes, and comments persist in SQLite. The feed loads newest first, supports loading older posts, and refreshes every 30 seconds or using the refresh button.

- React Router routes for `/`, `/faculty/*`, `/student/*`, `/admin/*`, and invitation links at `/join/:token`, including production history fallback. Student/faculty Overview, portal Home buttons and Discussions chat are removed; administration retains its Overview dashboard.
- Email/password sign-in with persisted sessions and server-enforced portal roles; optional college OTP or Google verification.
- New password-mode students choose their year of study and receive Whole College and matching academic memberships. Department, year and section determine their academic community. Administrators can update account years. Email ownership is not verified by password registration.
- Students can request optional activity memberships and leave optional groups. Managers approve new joins; links and QR codes do not bypass approval.
- Administrator-approved faculty group requests, assigned faculty managers, and approval-based invitation memberships.
- Multi-group circular targeting with a deduplicated recipient preview. Preview filters help inspect students; delivery uses the full membership of selected groups.
- Year → Department → Section academic communities. Administrator-assigned faculty can teach multiple matching-department classes, create subjects and upload PDF, DOCX or supported images up to 5 MB. Matching students can view and download materials.
- Department-filtered staff assignment, administrator-reviewed group requests, clubs and sports groups, multiple staff designations, and approval-based QR/link invitations. Designations are labels rather than independent permission grants.
- Server-side audience resolution and membership-filtered student inboxes.
- Socket.IO invalidation so an eligible signed-in student sees a new circular without polling.
- Authorized text downloads and persisted read status.
- TanStack Query for all server state; component state is limited to forms, filters, and dialogs.

The React portals also include Smart Compose audience suggestions, editable priority/date/summary, required acknowledgments, individual recipient analytics, calendar export, and browser push controls. Smart Compose runs locally without an external AI account. The production build supports installation and caches the application shell; inbox data still requires a connection.

Web Push requires browser permission. Email fallback uses SMTP when configured; otherwise it is captured locally using a JSON transport and does not send real email. See `.env.example` for configuration variables and set them in the server environment.

## Project map

```text
index.html                         Vite document entry
src/client/main.jsx                React, Router, and Query providers
src/client/App.tsx                 Typed application shell and role gates
src/client/components/             Auth, faculty, student, and dialog components
src/client/test/                   Focused React behavior tests
styles.css                         Shared responsive phone-shell design
vite.config.mjs                    Build, tests, and API/WebSocket dev proxy
server.js                          Express and Socket.IO entry point
src/app.js                         API routes, authorization, and built-client serving
src/db.js                          SQLite schema and demo seed
src/repository.js                  Membership-safe data access
test/                              Backend unit and integration tests
```

## Production notes

The demo intentionally uses a single-process SQLite deployment. Use HTTPS, set a strong `SESSION_SECRET`, preserve the database volume and configure `APP_URL` to the public origin. Production startup requires a session secret of at least 32 characters. Configure SMTP and outbound delivery only when real email notifications are needed; normal password sign-in does not require them. Notification dispatch jobs are persisted in SQLite. Institutional mailbox ownership requires the optional college OTP or Google identity flow.

Analytics now includes reporting periods, unique audience reach, daily activity, category totals and per-circular performance. The application shell, API client, group creation dialog and shared navigation, theme and modal components are checked under strict TypeScript. Production startup requires a 32-character session secret and skips demo seeding on fresh databases.

Portals, analytics, dashboards and Circular Studio load on demand, reducing the initial download. Loading indicators provide feedback, and a screen failure offers a reload action. Opening an uncached screen requires a connection.

Faculty submit group proposals and administrators review them before creation. Group settings include category, description, icon, optional study year, department, section, parent group, selected students, and assigned faculty managers. Student joins need approval. See [groups and invitations](docs/GROUP_APPROVALS.md) for clubs, sports, multiple staff designations, QR invitations and manager permissions. A preview counts selected members without duplicates. Automatic matching adds current students once at creation and requires at least one filter; with no filters, only explicitly selected students are added.

## Registration details

New student accounts require a full name, email, CampusRelay password, register number/student ID, department, year of study, section, and academic session. New faculty accounts require a full name, email, password, employee/faculty ID, department, and designation. Degree/program fields, including the B.Tech/BCA example, have been removed from registration, profile settings and audience selection. Existing stored profile values are preserved. Phone contact is optional for both roles. Registration confirms the password and saves the details atomically with the account. Users can view and update their details under Profile & preferences. Existing accounts and profiles are preserved.

## Application updates and Railway

Pushes to the connected GitHub branch trigger Railway deployment when autodeploy is enabled. Confirm both the deployment status and the public app before announcing a release. The running build is available at `/api/version`; service health is available at `/api/health`.

Refresh or reopen an already open browser or installed web app to load the latest version online. The **Update available** and **Updating** screens and automatic release announcement notifications have been removed. Updating the website does not publish or update a Play Store APK. Installation and browser push depend on browser/device support; reading fresh inbox data requires a connection.

Use the existing Railway service and preserve its persistent volume at `/app/data`. Do not replace the service or delete its volume when deploying code changes. Configure `DB_PATH=/app/data/notify-circular.db`, the public `APP_URL`, a strong session secret, and trusted reverse-proxy settings as appropriate for the deployment. Never commit secrets or database files.

Local and Railway accounts belong to separate databases. A local `127.0.0.1` invitation cannot be opened on another device to reach your laptop; share invitations from the public app instead.

## Documentation

- [Project review walkthrough](docs/PROJECT_REVIEW.md)
- [Academic classes, staff assignments and materials](docs/CLASS_MATERIALS.md)
- [Group approvals, designations and invitations](docs/GROUP_APPROVALS.md)
- [Optional Google sign-in setup](docs/GOOGLE_SIGN_IN.md)
- [Server environment reference](.env.example)
