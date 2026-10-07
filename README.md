# CampusRelay

CampusRelay is a multi-user college circular system. Faculty send one circular to one or more groups, and students see it only when their persisted SQLite memberships match at least one target.

CampusRelay uses React, React Router, TanStack Query, Vite, Express, SQLite, bcrypt sessions, and Socket.IO. It preserves the original phone-shell interface while replacing manual DOM screen toggling with real routes.

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

## Demo accounts

| Role | Email | Password | Memberships |
| --- | --- | --- | --- |
| Faculty | `faculty@demo.edu` | `Faculty123!` | Faculty portal |
| Student | `asha@demo.edu` | `Student123!` | First Year, Sports Group, Whole College |
| Student | `ravi@demo.edu` | `Student123!` | Final Year, Whole College |

The guided demo buttons still submit these credentials to the real login endpoint. They do not bypass authentication.

## Platform upgrade

Open **More** on mobile or use the desktop sidebar for Overview, Circular studio, Saved notices, and Preferences. Both portals have global search (Ctrl/Cmd K) and a notification center. Faculty can save drafts and templates, schedule circulars, attach protected files, and create expiring attendance QR codes. Students can save notices and use list/month calendar views. Administrators can manage users and groups, moderate reported posts/comments, and inspect audit history at `/admin`.

Local administrator: `admin@demo.edu` / `Admin123!`. Production provisioning, API details and implementation limits are documented in [docs/PLATFORM.md](docs/PLATFORM.md).

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
- Responsive workspace: desktop sidebar navigation and wider content, mobile bottom tabs, a home shortcut in each portal, clearer search fields, and contextual empty states.

- Shared **Campus** feed in both portals: all signed-in students and faculty can publish college updates and achievements, attach one JPEG/PNG/WebP photo (up to 2 MB), like posts, and comment. Authors can delete their own posts. Posts, photos, likes, and comments persist in SQLite. The feed loads newest first, supports loading older posts, and refreshes every 30 seconds or using the refresh button.

- React Router routes for `/`, `/faculty/*`, and `/student/*`, including production history fallback.
- Real faculty and student login with bcrypt-hashed passwords and persisted Express sessions.
- Student registration with automatic year and Whole College membership.
- Optional activity memberships that students can update themselves.
- Faculty-created custom or activity groups with explicit student membership management.
- Multi-group circular targeting.
- Server-side audience resolution and membership-filtered student inboxes.
- Socket.IO invalidation so an eligible signed-in student sees a new circular without polling.
- Authorized text downloads and persisted read status.
- TanStack Query for all server state; component state is limited to forms, filters, and dialogs.

The React portals also include Smart Compose audience suggestions, editable priority/date/summary, required acknowledgments, individual recipient analytics, calendar export, and browser push controls. Smart Compose runs locally without an external AI account. The production build supports installation and caches the application shell; inbox data still requires a connection.

Web Push requires browser permission. Email fallback uses SMTP when configured; otherwise it is captured locally using a JSON transport and does not send real email. See `.env.example` for configuration variables and set them in the server environment.

## Guided demo

1. Open the home screen. Say: "CampusRelay routes official notices by real membership, not by hiding rows in the browser." Click **Faculty portal**, then **Try now**.
2. Open **Groups**. Say: "Year and campus groups are automatic; faculty can also create a precise audience." Click **Create group**, name it **Robotics Club**, select Ravi, and create it.
3. Open **Compose**. Enter: **Robotics lab access is available Friday at 3 PM. Bring your college ID.** Review the suggested audience, date, priority, and summary. Click **Add group**, select **Robotics Club** and **Whole College**, then click **Use 2 groups**.
4. Click **Review & send**. Point to the estimated reach and say: "Group memberships can overlap; the server response reports the exact deduplicated audience." Click **Send circular**.
5. In a private window, open the student portal and sign in as Asha. Say: "Asha receives the Whole College copy because that membership is stored in SQLite." Open the circular and show **Download .txt**.
6. Return to the faculty window and open **Sent**. Say: "The circular, targets, and current audience survive refreshes and server restarts. This is now a multi-user system rather than a single-tab mockup."

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
