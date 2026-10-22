# Kutlerri Customer Operations

Next.js 15 dashboard backed by PostgreSQL (Prisma). Data is synced from the internal API; admins upload files that are committed to this GitHub repo.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and fill it in (`DATABASE_URL`, `AUTH_SECRET`, `ADMIN_*`, `API_*`, `GITHUB_*`).
3. `npx prisma migrate dev --name init` creates the tables.
4. `npm run db:seed` creates the admin user.
5. `npm run dev`, then open http://localhost:3000.

## Pieces
- `src/lib/api-client.ts`: internal API client for **calls** and **mails** (stored in Postgres). Endpoint paths and field mapping are placeholders to adjust.
- `src/lib/sheets.ts`: parses uploaded `.xlsx` files (not legacy `.xls`) from `data/` for display on the dashboard.
- `src/lib/sync.ts` and `POST /api/sync`: pulls the API data into Postgres. Run it from the Admin page, or from a scheduler with `Authorization: Bearer $CRON_SECRET`.
- `/admin`: upload a file and the app commits it to `GITHUB_UPLOAD_DIR` (default `data/`) on `GITHUB_BRANCH` using a fine-grained token. Admins can also delete files and trigger a manual API sync.
- Deploy flow: upload, then commit on GitHub, then your host (e.g. Vercel) rebuilds, then the dashboard shows the new files from the build. No database is involved for files.
- `/dashboard`: KPIs, status breakdown, records table and the list of files in the current build. Any signed-in user.
- Auth: email/password (bcrypt), signed JWT cookie, roles `ADMIN` and `VIEWER`, enforced in `src/middleware.ts` and again in each route.
