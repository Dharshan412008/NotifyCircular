# Platform upgrade

The Aurora Pulse interface adds desktop navigation, mobile More navigation, light/dark/system appearance, dashboards, a searchable notification center, profile preferences, saved student circulars, calendar views, campus reports, and a faculty circular studio.

## API map

Group discussion endpoints live under `/api/discussions`: channel discovery, `/:groupId/messages` (search, pinned filter, cursor pagination), `/:groupId/read`, and per-message reactions, pins and removal. Every request rechecks current membership or staff role, including access to reply targets. Students cannot pin or remove other authors' messages. Removed text is scrubbed from quoted replies. Discussion reads are independent of official circular acknowledgments. Messages and reactions use SQLite; active views poll every five seconds without browser/email notifications.

Every private endpoint uses the persisted session and server role checks.

- `/api/platform/overview`, `/search?q=`, `/events`: personalized discovery.
- `/api/platform/circulars?saved=true`: paginated saved collection. PUT/DELETE `/circulars/:id/save` changes the student's private save.
- `/api/platform/notifications`: GET updates and DELETE clears; POST `/notifications/read` accepts an optional `id`.
- `/api/platform/profile`, `/preferences`: GET and PUT own details/preferences.
- `/api/circular-tools/templates`, `/items`: faculty templates, drafts and schedules; `/send` publishes; `/preview` resolves the real deduplicated audience.
- `/api/circular-tools/attachments`: faculty uploads, maximum 5 MB each, content validation, authenticated downloads.
- `/api/circular-tools/attendance/preview`, `/attendance/check-in`: time-limited student event check-in.
- `/api/admin/users`, `/groups`, `/reports`, `/audit`, `/config`, `/notifications`, `/stats`: administrator management.
- POST `/api/reports`: private campus-post/comment report with `targetType`, `targetId`, `reason`.

## Architecture and operation

SQLite migrations run idempotently at startup. Existing users, memberships, notices and posts remain in `data/notify-circular.db`. The React client keeps server state in TanStack Query. Socket.IO invalidates circular, campus and notification queries. Search and notification reads recheck current membership.

Schedules use persisted work items and dispatch jobs; the server checks due jobs every 15 seconds and catches up after restarts. Circular publication is idempotent for saved work. External delivery retries can repeat a notification if a process stops after sending it. Digest delivery runs hourly for queued items at least 24 hours old. Development uses local email previews unless `ALLOW_OUTBOUND_NOTIFICATIONS=true` is explicitly configured.

Run `npm run create-admin` with `ADMIN_EMAIL`, `ADMIN_PASSWORD` (12+ characters), and optional `ADMIN_NAME` to provision an administrator without overwriting accounts. Local demo admin: `admin@demo.edu` / `Admin123!`; it is not seeded in production.

Docker: set `SESSION_SECRET`, configure HTTPS reverse proxy and `APP_URL`, then `docker compose up --build -d`. SQLite persists in the named volume. Secure production cookies require HTTPS. Docker configuration is supplied but must be tested on the target host. Fresh production databases create only built-in audiences, with no demo users or notices. Existing accounts are preserved; disable any old demo accounts before public use. Production requires SESSION_SECRET of at least 32 characters.

## Scope and validation

Strict TypeScript checks the application shell, route recovery boundary, group creation dialog, API client, analytics screen, shared contracts, navigation, modal, and theme components; the remaining React JSX and Express JavaScript remain intact. This is an incremental migration, not a full TypeScript conversion. Portals and heavier screens load on demand with loading feedback and reload recovery. Production SSO, distributed jobs, and institutional policies still require deployment-specific work. `npm run verify` runs typechecking, API/component tests, build, and Edge desktop/mobile browser flows against an isolated in-memory database.

Faculty Analytics is available at `/faculty/analytics` and `/api/platform/analytics?days=30` (1?365 days). It reports unique recipients separately from recipient?circular pairs, with current membership-based read and acknowledgment rates. Aggregate totals cover the full period; the detail list shows its latest 100 notices.
