# Kutlerri Customer Success Operations Dashboard

Two separate apps that talk over HTTP:

| | Stack | Role |
|---|---|---|
| `backend/` | Express, TypeScript, Prisma, PostgreSQL | Collects calls and emails on a schedule, applies the business rules, will serve the dashboards |
| `frontend/` | Next.js 15, React, Tailwind | The website. It holds no data or secrets and proxies `/api/*` to the backend (`BACKEND_URL`) |

**Status: Phase 2 of 5** (ingestion, then who dialed for whom, attribution and daily counts). See [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md) for what was found, assumed and still needs a decision.

## What Phase 2 adds
- The **who-dialed-for-whom sheet** is stored as dated rows (weekly, monthly or **daily**; the most specific period wins), with a **preview**, **rollback**, and a no-op when the same sheet is uploaded twice. Endpoints: `POST /api/admin/assignments/preview`, `POST …/commit`, `GET …/uploads`, `POST …/uploads/:id/rollback`. The sheet is sent as rows of cells; the file reader and upload screen come with the admin console in Phase 4.
- Each call is **attributed** to a Representative and client (or flagged Internal, Unassigned or Undecided) and counted in **daily rollups**. Both refresh automatically after every sync, upload or rollback.
- `npx tsx src/scripts/importReference.ts "<prototype HTML>"` loads the phone list embedded in the prototype; `npx tsx src/scripts/acceptance.ts "<prototype HTML>"` checks the acceptance numbers (run both from `backend/`).

## What Phase 1 does
- Reads **calls** and **emails** from the call-logs API for every day since **2026-08-17**, then keeps them current (calls every 15 minutes, emails every 30).
- Stores calls with their provider time, the UTC instant, the **IST shift day** (5 PM to 5 PM IST), the agent and a mapped disposition.
- Stores emails with the **client (by sender domain)** and Apollo's **Pacific date**.
- Running a job again never duplicates or rewrites anything; changed rows are updated in place.
- `GET /api/status` and a small "Data status" page show what is stored, when it last synced, and what needs attention.

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
- **Frontend:** a Next.js host such as Vercel, with `BACKEND_URL` set to the backend's public URL.
