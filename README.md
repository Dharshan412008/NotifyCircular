# CampusRelay

CampusRelay is a multi-user college circular system. Faculty send one circular to one or more groups, and students see it only when their persisted SQLite memberships match at least one target.

CampusRelay uses React, React Router, TanStack Query, Vite, Express, SQLite, bcrypt sessions, and Socket.IO. It preserves the original phone-shell interface while replacing manual DOM screen toggling with real routes.

Academic communities follow Year → Department → Section. Assigned faculty can create subjects and share downloadable study materials. See [class setup and materials](docs/CLASS_MATERIALS.md) for administrator and staff instructions.

## Run it

Requires Node.js 20.19 or newer.

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

This runs the API and React component suites, builds the client, and runs Playwright against a dedicated in-memory server on port 3100. The browser tests never read or modify `data/notify-circular.db`.

## College sign-in

First visits open the login screen. Select Student or Faculty and sign in with your email and CampusRelay password. Gmail and other valid email addresses are accepted. No OTP, email sender, or Google Cloud setup is required in the default `AUTH_MODE=password` mode. New students choose **New student? Create an account**, enter their name, email and academic year, and create a password of at least eight characters. Do not enter your Gmail password.

Faculty can choose **New faculty? Create an account** in the Faculty portal to register with an email and CampusRelay password. Faculty registration in normal password mode grants faculty access immediately. Administrator accounts must still be provisioned. Existing accounts cannot switch roles by selecting another portal. Students can sign in through the Faculty portal to explore a demo workspace with sample circulars, groups, and delivery reports. Demo actions stay in the browser and never send real circulars. Existing account passwords continue to work. Email ownership is not verified in normal password mode. Optional college OTP uses `AUTH_MODE=college`; optional Google sign-in uses `AUTH_MODE=google`.

## Implemented features

- **Discussions** brings group channels, quoted replies, four emoji reactions, unread counts, message search and faculty-managed pins to both portals. Find it in the desktop sidebar or **More → Discussions** on mobile. Students can access only their current groups; faculty can oversee all non-role groups. Messages refresh every five seconds, with older-message pagination and a separate mark-read action. Authors can remove their messages; faculty can moderate and pin up to five messages per group.

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
- Responsive workspace: desktop sidebar navigation and wider content, mobile bottom tabs, a home shortcut in each portal, clearer search fields, and contextual empty states.

- Shared **Campus** feed in both portals: all signed-in students and faculty can publish college updates and achievements, attach one JPEG/PNG/WebP photo (up to 2 MB), like posts, and comment. Authors can delete their own posts. Posts, photos, likes, and comments persist in SQLite. The feed loads newest first, supports loading older posts, and refreshes every 30 seconds or using the refresh button.

- React Router routes for `/`, `/faculty/*`, and `/student/*`, including production history fallback.
- Email/password sign-in with persisted sessions and server-enforced portal roles; optional college OTP or Google verification.
- Verified first-time students receive Whole College membership; academic year is assigned by administrators.
- Optional activity memberships that students can update themselves.
- Faculty-created custom or activity groups with explicit student membership management.
- Multi-group circular targeting.
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

The demo intentionally uses a single-process SQLite deployment. Before public use, configure HTTPS and SMTP, set a strong `SESSION_SECRET`, add institutional identity verification or SSO, define retention and audit policies, and move notification work to a durable queue.

Analytics now includes reporting periods, unique audience reach, daily activity, category totals and per-circular performance. The application shell, API client, group creation dialog and shared navigation, theme and modal components are checked under strict TypeScript. Production startup requires a 32-character session secret and skips demo seeding on fresh databases.

Portals, analytics, dashboards and Circular Studio load on demand, reducing the initial download. Loading indicators provide feedback, and a screen failure offers a reload action. Opening an uncached screen requires a connection.

Group creation in the faculty and admin portals includes type, description, icon, study year, department, section, parent group, explicit student selection, and independent self-joining permissions. A preview counts selected members without duplicates. Automatic matching adds current students once at creation and requires at least one filter; with no filters, only explicitly selected students are added.

## Registration details

New student accounts require a full name, email, CampusRelay password, register number/student ID, department, degree/program, year of study, section, and academic session. New faculty accounts require a full name, email, password, employee/faculty ID, department, and designation. Phone contact is optional for both roles. Registration confirms the password and saves the details atomically with the account. Users can view and update their details under Profile & preferences. Existing accounts and profiles are preserved.

## Application updates

Every production build includes a unique release ID. Open apps check `/api/version` once a minute while visible, and on reconnect or returning to the tab. A new release opens an **Update available** screen with **Update**, **What’s new**, and **Later**. Updating shows an indeterminate loading screen while checking the server, then reloads the app. Offline failures offer a retry, so unfinished work is not discarded automatically. Installed apps fetch the current page when reopened online. Users on versions older than this update must refresh or reopen once to receive the update prompt feature.

Railway updates should use the existing service and its persistent volume at `/app/data`; do not replace the service or delete its volume. Push to the connected GitHub branch to trigger deployment when autodeploy is enabled. Confirm the new deployment succeeds before announcing availability to users. GitHub source updates alone do not confirm a live release.

### Existing-user update announcement

The registration/profile release creates one persistent in-app update notification for each existing enabled account when the production build starts. It queues browser push for existing eligible subscriptions (respecting the current notification preference), with up to three attempts and no email blast. Duplicate restarts do not repeat the announcement. Disabled accounts, expired subscriptions and reassigned devices are excluded. Devices without push permission receive the notice inside CampusRelay when opened. Browser push delivery is subject to browser and OS support; it cannot silently replace a Play Store APK. A website-installed app loads the latest version when reopened or updated.
