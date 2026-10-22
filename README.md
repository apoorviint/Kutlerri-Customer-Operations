# Kutlerri Customer Success Operations Dashboard

Two separate apps that talk over HTTP:

| | Stack | Role |
|---|---|---|
| `backend/` | Express, TypeScript, Prisma, PostgreSQL | Collects calls and emails on a schedule, applies the business rules, serves every number the dashboards show |
| `frontend/` | Next.js 15, React | The website. It holds no data or secrets and proxies `/api/*` to the backend (`BACKEND_URL`) |

**Status: Phase 5 of 5** (sign-in, roles, hardening, deploy). Deploying: [docs/DEPLOY.md](docs/DEPLOY.md). When something looks wrong: [docs/RUNBOOK.md](docs/RUNBOOK.md). See [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md) for what was found, assumed and still needs a decision.

## What Phase 5 adds
- **Google sign-in restricted to the company domain** (OpenID Connect with PKCE; the account's domain and the email's domain must both match, and the email must be verified). New people arrive as **viewers**; `ADMIN_EMAILS` and **Admin console → People** make administrators, pre-register people and switch access off (takes effect within 30 seconds; you cannot remove your own access or the last administrator). The email/password form stays for development and turns itself off in production once Google is configured.
- **Hardening:** protective headers on the API and the website, request limits (900 a minute per address, 120 upload requests an hour), uploaded files checked by their contents (an .xlsx must really be a workbook), JSON request logs with an id, no caching of private data, and a cookie for an unknown user is refused in production.
- **Health checks** for monitoring: `/health`, `/health/ready` (database), `/health/feeds` (503 when the calls feed is stale or failed).
- **CI** (`.github/workflows/ci.yml`): type-check, tests (with a Postgres) and builds. **Dockerfiles** for both apps. `.env.example` files for both.
- **Docs:** [DEPLOY.md](docs/DEPLOY.md) (Google setup, Cloud Run, Cloud Scheduler, monitoring, go-live checklist) and [RUNBOOK.md](docs/RUNBOOK.md).

## What Phase 4 adds
An **Admin console** (`/admin`, administrators only; the dashboard header shows a link for admins) with:
- **Data quality**: calls with no client (by phone line, with counts and first/last seen), lines listed for two clients, suspicious swaps, orders whose Total does not add up, calls without a recording, unmapped agents, emails from unknown domains, last sync per feed and a stale-feed alert (no new calls for more than 2 hours during a shift).
- **Who dialed for whom**: upload an .xlsx or .csv (the old wide sheet or the simple template, daily uploads included), check it first (what would be added, replaced or removed per period, errors, warnings), save, see the history, roll back. Calls are recalculated in the background.
- **Prospect databases**: upload a client's databases (several sheets, 20 MB and more, read in a stream in the background with progress). Columns are found automatically; add to the client's databases or replace them (with a confirmation); shows rows read, phone numbers indexed and calls newly matched; per-client batch list; roll back.
- **Billing**: upload the billing sheet; orders are added or updated by invoice number; preview with differences and flagged totals; history and rollback (latest upload); the Overview shows when billing was last uploaded.
- **Mappings and settings**: agent to Representative, email sender to client (domain, mailbox or sequence), time zone rules, schedules and break rules, the agent-fallback rule, the start date, new Representatives and clients.
- **Jobs**: re-run any job for a date range; recent runs. **Audit log**: every upload, rollback, job run and setting change.
- Template downloads for every upload (`GET /api/admin/templates/<name>`). Uploaded files are kept in private storage (`UPLOAD_DIR`, never served directly).
- Endpoints (all admin only): `/api/admin/files/{assignments,billing,prospects}/…`, `/api/admin/{mappings,settings,agents,apollo-rules,tz-rules,representatives,clients,data-quality,audit,templates}`.
- `backend/.env` also needs `UPLOAD_DIR` (default `./data/uploads`).

## What Phase 3 adds
- **Overview** (opens first), **Representative View** and **Client View**, in the prototype's purple look (light and dark): date range and quick periods, KPI cards with the change against the days before, expandable and sortable calls tables, weekly revenue with hover lists, call timing and breaks (daily and weekly), Representative and client profiles with call recordings (prospect lines, search, filters) and a client's emails.
- Backend endpoints for all of it (`/api/overview`, `/reps/table`, `/clients/table`, `/reps/:id/profile`, `/clients/:id/profile`, `…/recordings`, `/clients/:id/emails`, `/emails/:id`, `/revenue/weekly`, `/timing/*`), cached per question and cleared when data changes.
- `npm run e2e` in `frontend/` drives the real dashboard in Chrome (needs both apps running with data).

## What Phase 2 adds
- The **who-dialed-for-whom sheet** is stored as dated rows (weekly, monthly or **daily**; the most specific period wins), with a **preview**, **rollback**, and a no-op when the same sheet is uploaded twice. Endpoints: `POST /api/admin/assignments/preview`, `POST …/commit`, `GET …/uploads`, `POST …/uploads/:id/rollback`. The sheet is sent as rows of cells; the file reader and upload screen come with the admin console in Phase 4.
- Each call is **attributed** to a Representative and client (or flagged Internal, Unassigned or Undecided) and counted in **daily rollups**. Both refresh automatically after every sync, upload or rollback.
- `npx tsx src/scripts/importReference.ts "<prototype HTML>"` loads the phone list embedded in the prototype; `npx tsx src/scripts/acceptance.ts "<prototype HTML>"` checks the acceptance numbers (run both from `backend/`).

## What Phase 1 does
- Reads **calls** and **emails** from the call-logs API for every day since **2026-08-17**, then keeps them current (calls every 15 minutes, emails every 30).
- Stores calls with their provider time, the UTC instant, the **IST shift day** (5 PM to 5 PM IST), the agent and a mapped disposition.
- Stores emails with the **client (by sender domain)** and Apollo's **Pacific date**.
- Running a job again never duplicates or rewrites anything; changed rows are updated in place.
- `GET /api/status` shows what is stored, when it last synced, and what needs attention (it moves into the admin data-quality panel in Phase 4).

## Run locally
```
# terminal 1: backend
cd backend
npm install
cp .env.example .env         # fill in DATABASE_URL, AUTH_SECRET, ADMIN_*
npx prisma migrate deploy
npm run db:seed              # creates the admin user
npm run dev                  # http://localhost:4000   (set ENABLE_SCHEDULER=true to run the timers)

# terminal 2: frontend
cd frontend
npm install
cp .env.example .env         # BACKEND_URL=http://localhost:4000
npm run dev                  # http://localhost:3000
```
The first run of the calls job loads everything since 17 Aug (about 66,000 calls, around 3 minutes). Start it from the command line:
```
curl -X POST -H "Authorization: Bearer $CRON_SECRET" "http://localhost:4000/api/jobs/calls/run?wait=1"
```

## Jobs
`POST /api/jobs/<name>/run` (admin session, or `Authorization: Bearer $CRON_SECRET`). Add `?from=YYYY-MM-DD&to=YYYY-MM-DD` to re-run a date range, and `?wait=1` to wait for the result. `GET /api/jobs/runs` lists recent runs.

| Job | What it does | Schedule |
|---|---|---|
| `calls` | read calls from the API | every 15 min |
| `emails` | read emails from the API | every 30 min |
| `recompute-call-times` | re-apply time rules to stored calls (after editing a time zone rule) | on demand |
| `recompute-email-clients` | re-apply email-to-client rules to stored emails | on demand |
| `attribute-calls` | work out Representative and client per call, then rebuild the daily counts (`from` and `to` are shift days) | after every sync, upload and rollback |
| `rebuild-rollups` | rebuild only the daily counts | on demand |

In production use Cloud Scheduler to call the first two (the service can scale to zero, so in-process timers are not reliable).

## Tests
```
cd backend
npm test                                   # the business rules (no database needed)
TEST_DATABASE_URL="postgresql://…/customer_ops_test" npm test   # plus the ingestion tests (needs an empty UTF-8 Postgres)
```

## Deploy
- **Backend:** `backend/Dockerfile` (Cloud Run). It runs `prisma migrate deploy` on start.
- **Frontend:** `frontend/Dockerfile` (Cloud Run) or a Next.js host such as Vercel, with `BACKEND_URL` pointing at the backend. Vercel caps upload size at about 4.5 MB; see docs/DEPLOY.md.
