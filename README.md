# Kutlerri Customer Operations

Two separate apps that talk to each other over HTTP:

| | Stack | Role |
|---|---|---|
| `backend/` | Express, TypeScript, Prisma, PostgreSQL | Login, syncs calls and emails from the call-logs API into Postgres, serves stats and tables, parses Excel files, commits admin uploads to GitHub |
| `frontend/` | Next.js 15, React, Tailwind, Recharts | The dashboard and admin UI. It holds no secrets or data of its own |

The frontend proxies `/api/*` to the backend (`BACKEND_URL`, see `frontend/next.config.ts`). The browser only ever talks to the frontend, so the session cookie is same-origin: no CORS and no third-party cookies.

## Data flow
- **Calls and emails:** `https://call-logs-api-…run.app/v1/calls` and `/v1/emails` are synced into Postgres. The first sync loads everything (about 111k rows, around 4 minutes). Later syncs fetch only the last two days and take seconds. Trigger it from Admin, or on a schedule with `POST /api/sync?wait=1` and `Authorization: Bearer $CRON_SECRET`.
- **Spreadsheets:** an admin uploads a file, the backend commits it to `backend/data/` on GitHub (fine-grained token), your host rebuilds the backend image, and the dashboard shows the new `.xlsx` files. No database is involved.

## Run locally
```
# terminal 1
cd backend
npm install
cp .env.example .env        # fill in DATABASE_URL, AUTH_SECRET, ADMIN_*, GITHUB_*
npx prisma migrate deploy
npm run db:seed             # creates the admin user
npm run dev                 # http://localhost:4000

# terminal 2
cd frontend
npm install
cp .env.example .env        # BACKEND_URL=http://localhost:4000
npm run dev                 # http://localhost:3000
```
The Postgres database must be **UTF-8** (the default on any normal install). Names in the data contain non-Latin characters.

## Deploy
- **Backend:** `backend/Dockerfile` (fits Cloud Run). It runs `prisma migrate deploy` on start. Redeploy on every push to `main` so uploaded spreadsheets reach the running service.
- **Frontend:** any Next.js host (Vercel etc.) with `BACKEND_URL` set to the backend's public URL.

## GitHub token
Fine-grained personal access token, **only this repository**, Repository permissions: **Contents = Read and write** (Metadata read-only is added automatically). Nothing else. Set an expiry and renew it. Make sure `main` is not protected against direct pushes, or point `GITHUB_BRANCH` at an unprotected branch your host deploys.

## Notes
- Call times from the API have no timezone, so they are shown as stored and labelled UTC.
- The call-logs API pages by offset over a sort with ties, which can skip rows. The sync detects that (distinct ids vs the API's total) and re-walks with a different page size.
- The call-logs API is currently public and exposes phone numbers and email addresses. Consider protecting it, and set `CALL_LOGS_API_TOKEN` if you do.
- Only `.xlsx` is parsed for display (not legacy `.xls`).
