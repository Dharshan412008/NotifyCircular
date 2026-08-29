# CampusRelay

CampusRelay is a runnable, multi-user college circular demo. Faculty can compose one notice, use a local Smart Compose classifier to suggest audiences, edit those suggestions, and send to several groups. Students receive one deduplicated inbox item only when their real database memberships match a target group.

The app keeps the original mobile phone-shell idea, but now has a Node/Express backend, SQLite persistence, password authentication, realtime updates, read/acknowledgment accountability, calendar/text exports, notification delivery hooks, and an installable PWA shell.

## Run it

Requires Node.js 20 or newer.

```powershell
npm.cmd install
$env:SESSION_SECRET = "local-demo-secret-change-me"
npm.cmd start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The database is created at `data/notify-circular.db` and survives restarts.

Run the automated checks with:

```powershell
npm.cmd test
```

## Demo accounts

| Role | Email | Password | Memberships |
| --- | --- | --- | --- |
| Faculty | `faculty@demo.edu` | `Faculty123!` | Faculty portal |
| Student | `asha@demo.edu` | `Student123!` | First Year, Sports, Whole College |
| Student | `ravi@demo.edu` | `Student123!` | Final Year, Whole College |

The welcome flow can fill these credentials through “Try now”; authentication still goes through the real server and bcrypt password check.

## 75-second demo script

1. **Say:** “CampusRelay makes sure an official notice reaches only the right people—and proves who acted on it.” Click **Continue as faculty**, use **Try now**, and sign in.
2. **Say:** “Smart Compose works locally, with no paid AI API.” Type: **“Urgent: football squad trials are on 18 September 2026 at 10 AM. Selected players must report by 9:30.”** Pause briefly. Point out the suggested Sports audience and confidence, detected date, urgent priority, generated summary, and acknowledgment toggle. Remove or add a chip to show every suggestion is editable.
3. Click **Review & send**, show the resolved audience and delivery channels, then **Send circular**.
4. In a second browser/private window, click **Continue as student** and sign in as Asha. **Say:** “Asha is first-year and opted into Sports, so the notice appears instantly. Ravi is final-year but not in Sports, so it never enters his inbox.”
5. Open the new circular. Show that opening marks it read, click **Acknowledge**, then point to **Add to calendar** and **Download text**.
6. Return to the faculty window, open **Sent**, select the new circular, and **say:** “The delivery report updates per recipient—read, acknowledged, or still waiting. This is accountability, not just a badge.”

## What is real in this demo

- Passwords are bcrypt-hashed; faculty/student routes are authorized server-side.
- SQLite persists users, groups, memberships, circulars, targets, reads, acknowledgments, sessions, push subscriptions, and local settings.
- Student inbox SQL is membership-filtered and deduplicates circulars that target overlapping groups.
- Student signup automatically assigns the selected year and Whole College groups. Students can opt into joinable activity groups; faculty can create custom groups and manage their members.
- Smart Compose is a deterministic local few-shot text classifier using word, sub-word, and semantic concept vectors. It does not download a model, send text to a paid API, or route using exact substring checks. The instant client date pass is refined by the server result after a 300 ms debounce.
- Socket.IO updates relevant logged-in student sessions without polling.
- Read and acknowledgment timestamps are stored per student. “Requires acknowledgment” is intentionally separate from FYI/Normal/Urgent.
- `.txt` and `.ics` files are generated server-side after the same audience authorization check as the inbox.
- Web Push uses a service worker and locally persisted VAPID keys. Browser permission and a secure context are still required; `localhost` is accepted by modern browsers.
- Email fallback uses configured SMTP when the variables in [.env.example](.env.example) are supplied. Without SMTP credentials, Nodemailer uses a JSON preview transport so the fallback path remains testable but no external email is falsely claimed as delivered.

## Project map

```text
index.html / styles.css / script.js   Vanilla SPA and phone-shell UI
server.js                             Express + Socket.IO entry point
src/app.js                            API routes and authorization boundary
src/db.js                             Schema, migrations, and demo seed
src/repository.js                     Membership-safe data access
src/classifier.js                     Local Smart Compose analysis
src/notifications.js                  Web Push and email fallback
src/exports.js                        Text and iCalendar generation
manifest.webmanifest / sw.js          Installability, offline shell, push worker
test/                                 Unit and API integration tests
```

## Production notes

The local demo intentionally defaults to a single-process SQLite deployment. Before a public rollout, set a strong `SESSION_SECRET`, configure HTTPS and SMTP, use managed secrets, add institutional identity verification or SSO, define retention/audit policies, and place notification jobs on a durable queue.
