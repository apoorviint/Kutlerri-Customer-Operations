# Deploying

Three pieces: a **database**, the **backend** (jobs and API) and the **website** (frontend). Nothing here needs code changes; it is settings and accounts.

## 1. Database
The backend uses the same Neon database as the JustCall and Apollo syncs (schema `call_logs`). The dashboard's tables are created by the backend's Alembic migrations, which Cloud Build runs on every deploy (`alembic upgrade head`).

## 2. Google sign-in (once)
1. Google Cloud console → APIs & Services → **OAuth consent screen**: choose **Internal** (only your company's Google Workspace accounts can ever see it).
2. **Credentials → Create credentials → OAuth client ID → Web application.**
3. **Authorized redirect URI:** `https://<your website address>/api/auth/google/callback` (add `http://localhost:3000/api/auth/google/callback` to try it locally).
4. Put the client ID and secret in the backend's `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, your domain in `ALLOWED_EMAIL_DOMAIN` (for example `company.com`), the website address in `PUBLIC_URL`, and the first administrators' emails in `ADMIN_EMAILS`.
5. The backend only lets in a verified Google account whose domain matches. Everyone else is a **viewer** until an administrator promotes them in **Admin console → People**.

Once Google is configured and `ENVIRONMENT=production`, the email and password form is switched off automatically (set `ALLOW_PASSWORD_LOGIN=true` to keep it).

## 3. Backend on Cloud Run
The backend is the `call-logs-api` service of the customer_call_logs_dashboard repository, deployed by its Cloud Build pipeline (`cloudbuild.yaml`: one instance, 2 GiB, CPU always on). Add the dashboard's settings once; later deploys keep them:
```
gcloud run services update call-logs-api --region us-central1 \
  --update-env-vars PUBLIC_URL=https://<website>,ALLOWED_EMAIL_DOMAIN=<domain>,ADMIN_EMAILS=<you@domain> \
  --update-secrets AUTH_SECRET=auth-secret:latest,CRON_SECRET=cron-secret:latest,GOOGLE_CLIENT_ID=google-client-id:latest,GOOGLE_CLIENT_SECRET=google-client-secret:latest
```
- **Secrets** go in Secret Manager, never in a repository.
- **Uploaded files** are not kept by the backend (the database keeps only the rows read from them); the website keeps the originals in GitHub, see section 5.
- "Allow unauthenticated" only means Google does not add its own login in front; every data route is protected by the app's own sign-in, and the job routes by `CRON_SECRET`.

## 4. Scheduled jobs (Cloud Scheduler)
Cloud Run can sleep, so the timers do not run inside it (`ENABLE_SCHEDULER` stays off). Create two scheduler jobs:
```
gcloud scheduler jobs create http sync-calls  --schedule "*/15 * * * *" --http-method POST \
  --uri "https://<backend>/api/jobs/calls/run?wait=1"  --headers "Authorization=Bearer <CRON_SECRET>" --attempt-deadline 900s
gcloud scheduler jobs create http sync-emails --schedule "*/30 * * * *" --http-method POST \
  --uri "https://<backend>/api/jobs/emails/run?wait=1" --headers "Authorization=Bearer <CRON_SECRET>" --attempt-deadline 900s
```
A run that is still going makes the next one answer "already running" (409); that is normal and safe. Every run repeats safely.

## 5. The website
**Best: also on Cloud Run** (no limit on upload size):
```
gcloud run deploy customer-ops-web --source frontend --region us-central1 --allow-unauthenticated \
  --set-build-env-vars BACKEND_URL=https://<backend> \
  --update-env-vars BACKEND_URL=https://<backend>,GITHUB_UPLOADS_REPO=apoorviint/Kutlerri-Customer-Operations,GITHUB_UPLOADS_BRANCH=main \
  --update-secrets GITHUB_TOKEN=github-uploads-token:latest
```
**Uploaded files** are committed by the website's server to `uploads/` on `GITHUB_UPLOADS_BRANCH` (main) of `GITHUB_UPLOADS_REPO`, once the backend has saved the upload. `GITHUB_TOKEN` is a fine-grained token with *Contents: read and write* on that one repository; it is used on the server only and never reaches the browser. The repository must be private (billing amounts, prospect names and numbers). If something deploys the website on every push to main, make it ignore `uploads/**` (the CI here already does). If main is protected, allow the token to push or uploads come back with a warning (the rows are still saved).

Use the address Cloud Run gives (or a custom domain) as `PUBLIC_URL` for the backend and in the Google redirect URI.

**Vercel works too,** with `BACKEND_URL` set in the project's environment variables, but Vercel limits request bodies to about 4.5 MB, which is too small for prospect databases and big sheets. If you use Vercel, upload those from a host without that limit.

## 6. Monitoring
- **Uptime checks** (Cloud Monitoring → Uptime checks, no sign-in needed): `https://<backend>/health/ready` (database reachable) and `https://<backend>/health/feeds` (turns 503 if the last good calls sync is older than 2 hours, or the latest one failed). Alert by email on failure.
- **Logs:** one JSON line per request and per failed job in Cloud Logging. Useful filter: `severity>=WARNING`.
- **Inside the app:** Admin console → Data quality (feeds, unassigned calls, stale-feed alert) and Jobs (recent runs with errors).
- **Backups:** turn on automatic backups and point-in-time recovery for the database; give the uploads bucket object versioning.

## 7. Checklist before going live
- [ ] `ENVIRONMENT=production` on the backend, all secrets in Secret Manager, none in git.
- [ ] Google consent screen is **Internal**; the redirect URI matches the website address exactly.
- [ ] `ADMIN_EMAILS` has at least two people.
- [ ] Both Scheduler jobs exist and **Jobs** in the console shows fresh runs.
- [ ] Uptime checks and an alert email are set.
- [ ] Database backups on; the uploads bucket is private.
- [ ] Sign in as a non-admin colleague: they see the dashboards and no Admin link; `/api/admin/mappings` answers 403.
- [ ] To bring over the prototype's carried-over numbers: `call-email-import-reference "<prototype HTML>"` (backend) against the production database from a trusted machine, then upload the real sheets in the console.
