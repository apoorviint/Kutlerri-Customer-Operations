# Runbook: when something looks wrong

Start at **Admin console → Data quality**. It lists what is wrong in plain words. Then follow the matching section.

## "No new calls for N hours during a shift" (or the uptime check /health/feeds is red)
1. **Jobs** tab → look at the newest `calls` run.
   - *failed* → read its note. "responded 5xx" or a timeout means the call-logs API is down: wait, then press **Run** again. Nothing is lost; the next run reads the gap.
   - no recent run at all → Cloud Scheduler is not calling: check the scheduler job and that its `CRON_SECRET` matches.
2. If runs are fine but "Newest record" is old, the call-logs API itself has stopped getting calls (it was once 17 hours behind). Tell the owner of that API; the numbers catch up on their own when it does.

## A sync failed or shows a warning
Open **Jobs**. Common notes:
- *"received X of Y rows even after retrying"*: the API's paging skipped rows. Press **Run** for that date range.
- *"rows could not be read"*: a row had a bad value; the others were saved. The note names the reason.
- *"Unrecognised dispositions"*: a new call outcome appeared. It is kept as "no disposition" until the mapping is extended in code (`backend/src/rules/calls.ts`).

To repair a period: **Jobs → Calls (or Emails) → From/To → Run**. Re-running is always safe and never duplicates.

## "Calls with no client"
Those calls are on a phone line that is not on the who-dialed-for-whom sheet for that day. Upload the sheet (**Who dialed for whom**); calls are re-assigned automatically. If a line is wrong for one day, upload a daily sheet for that day: the most specific period wins.

## Numbers look wrong
1. Pick one day and one Representative. Compare the Representative View with **Who dialed for whom → history** for that week: is the line assigned to the right client?
2. Check **Data quality → Suspicious swaps** and **lines listed for two clients**: a typo in the sheet shows up there.
3. After fixing a sheet or a mapping the app recalculates by itself. To force it: **Jobs → Work out who each call belongs to** (and, if only totals look stale, **Rebuild the daily numbers**) with the date range.
4. Times look an hour off for one person: **Mappings → Time zone rules** (their calling-tool clock may be set to another zone, as happened for three agents). Check again around 1 November when US clocks change.

## A bad upload
**Who dialed for whom / Prospect databases / Billing → upload history → Roll back.** Assignments and prospect uploads can be rolled back in any order; billing only the latest upload. Everything is recorded in the **Audit log**.

## An agent's calls are not counted
**Data quality → Agents not mapped** (or **Mappings → Agents → Representatives**): choose their Representative. Calls are recalculated.

## Emails are missing for a client
**Data quality → Emails that could not be matched** shows the sender domain. Add it under **Mappings → Email rules**. Older emails that appear in the source later are picked up by the next sync automatically.

## Someone cannot sign in
- *"Only @company accounts can sign in"*: they used a personal account. Use the company one.
- *"Your access has been switched off"*: **People** → switch on.
- They sign in but have no Admin link: they are a viewer; promote them in **People**.
- Nobody can sign in with Google: check `PUBLIC_URL` and the redirect URI in the Google console match the website address exactly, and that the secrets are set.

## A prospect database upload failed
**Prospect databases → Uploads** shows the reason (for example "no header with a name column and a phone/mobile column"). Fix the file or its header row and upload again. A failed upload changes nothing. If the service restarted midway, the upload is marked failed; upload again.

## Restoring from a mistake in the database
Use the database provider's point-in-time recovery to a moment before the mistake. Uploaded originals are in the uploads bucket, so any sheet can be uploaded again.

## Routine
- Daily: upload the day's who-dialed-for-whom sheet; glance at Data quality.
- Weekly: upload the billing sheet.
- When a new client or Representative starts: add them under **Mappings**, then upload their sheet and database.
