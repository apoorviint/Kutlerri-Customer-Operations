# Kutlerri Customer Operations

Next.js 15 dashboard backed by PostgreSQL (Prisma). Data is synced from the internal API; admins upload files that are committed to this GitHub repo.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and fill it in (`DATABASE_URL`, `AUTH_SECRET`, `ADMIN_*`, `API_*`, `GITHUB_*`).
3. `npx prisma migrate dev --name init` creates the tables.
4. `npm run db:seed` creates the admin user.
5. `npm run dev`, then open http://localhost:3000.

## Pieces
- `src/lib/api-client.ts`: internal API client. The response mapping is a placeholder to adjust.
- `src/lib/sync.ts` and `POST /api/sync`: pulls the API data into Postgres. Run it from the Admin page, or from a scheduler with `Authorization: Bearer $CRON_SECRET`.
- `/admin`: file upload (commits to `GITHUB_UPLOAD_DIR` on `GITHUB_BRANCH`) and a manual sync. Admins only.
- `/dashboard`: KPIs, status breakdown, records table and file list. Any signed-in user.
- Auth: email/password (bcrypt), signed JWT cookie, roles `ADMIN` and `VIEWER`, enforced in `src/middleware.ts` and again in each route.
