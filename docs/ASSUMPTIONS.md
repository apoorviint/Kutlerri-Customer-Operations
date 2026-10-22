# Assumptions and findings (Phase 0 and 1)

Each item says what was assumed, what it is based on, and what would change it.

## Where the data comes from
- **Calls and emails come from the call-logs API** (`/v1/calls`, `/v1/emails`), not from JustCall or Apollo directly. No JustCall or Apollo credentials were available.
- **The API's own data can lag.** On 22 Oct its newest call was from 02:56 IST and its last JustCall sync was 14 hours old, while its emails were 2 hours old. The status page shows this as a warning ("no new calls for N hours during a shift") rather than hiding it.
- **Nothing before 2026-08-17 is read or shown** (setting `backfillStart`). Earlier assignments will be supplied by the user later.

## Call times (IST)
- **The API's `date` and `time` carry no time zone.** They are US Eastern time, as shown by matching them against the workbook behind the prototype: with Eastern to IST (+9h30 in summer, +10h30 after 1 Nov 2026) 92.5% of the prototype's dials matched exactly on date, time and duration.
- **Three agents' clocks differ by one hour** (a per-agent rule, stored in `call_timezone_rules`, editable):
  - Abby Wilson (line Abby_Houston) and Robin Dale (line Robin_Chicago): US Central from 2026-09-28.
  - Andrew Robert (lines Andrew_NYC, Andrew_Dallas and his own): fixed UTC-3 from 2026-09-08. A fixed offset does not follow daylight saving, so **check around 1 Nov**.
  - Evidence: with these three rules **all 49,971 of the prototype's dials match** the stored data at the same IST date, time and duration, and every shift date is identical.
  - **Not yet confirmed in JustCall.** Call id 424380682 (Abby_Houston, API says 2026-10-09 16:05:18, workbook says 02:35:18 IST on Oct 10) would settle which source is right for these agents.
- **A shift day runs from 5 PM IST to just before 5 PM IST the next day.** The prototype used noon in its timing view and 5 PM elsewhere; the two never differ on the current data. 5 PM is used everywhere.
- All times are stored in UTC, with the provider's own date and time kept next to them so the rules can be re-applied (`recompute-call-times` job) without fetching again.

## Emails
- **The client is the sender's email domain.** Checked on all 7,469 emails in the reference file: every domain, mailbox and sequence belongs to exactly one client. Rasa has two domains (rasacatering.co, rasa.co). `kutlerricorp.com` is Kutlerri's own prospecting and is kept apart.
- **The API only contains Rasa (and Kutlerri) emails.** It has 1,194 emails since 17 Aug, all Rasa. The other five clients' emails (about 6,950 in the prototype for 17 Aug to 9 Oct) are not available through this API. **Open question for the user: where do they live?**
- **Bodies and replies are not in the API** (`body_html` is empty on all 31,152 emails and there is no detail endpoint). The columns exist but stay empty. A body must be cleaned of scripts before it is stored.
- **Apollo's date is Pacific time with daylight saving** (UTC-7 in Aug to Oct), not fixed UTC-8: the 519 emails that appear in both sources differ by exactly 7 hours. The date filter uses `sent_date_pacific`.
- For Rasa, 17 Aug to 9 Oct, the stored data equals the prototype on every figure (519 sent, 68 opened, 3 replied, 7 bounced, 3 unsubscribed).

## Calls: fields and rules
- **The API has no call direction.** All rows are assumed to be outbound.
- **Agents** are matched on a lower-cased name (the API writes "krissh singh"). The seeded mapping is the one in the prompt. **A new agent, "Baishnavi Sahoo" (525 calls, 12 to 17 Oct), is not mapped to a Representative** and is shown as a warning until an admin maps them.
- **Dispositions:** "Dispositions: X" is mapped to the 11 keys. An empty value stays empty (it counts as No Answer later). A new text is stored as-is, not guessed, and reported on the sync run.
- Connect, answered, meaningful (strictly over 90 s) and MQL rules are in `backend/src/rules/calls.ts` and covered by tests.

## Reading the API safely
- **The API pages by position over a list sorted by date and time, with many ties.** A row on a page boundary can appear twice while a neighbour is skipped (2 of 80,154 calls were lost in a first test). Each date window is read until the distinct ids received equal the API's total, re-reading with a different page size if needed. A shortfall that survives four attempts is reported as a warning, never hidden.
- Windows are one provider date at a time, so a long catch-up reports progress and any day can be re-run. An ordinary run re-reads from two days before the newest stored row, which also picks up late email opens and replies.

## Departures from the Phase 0 design
- **No job queue library yet.** Jobs use a lock table (`job_locks`) and a run log (`sync_runs`). A queue with progress reporting arrives with the upload jobs in Phase 4. Cloud Scheduler triggers the jobs in production; an in-process timer exists for local development.
- **Login is still email and password**; Google sign-in for the company domain is Phase 5.
- The earlier "upload commits to GitHub" flow and the first call-logs dashboard were removed (the new design stores uploads in private storage with preview and rollback).

## Not in Phase 1
Who-dialed-for-whom assignments and attribution, daily rollups, billing, prospect databases, the three dashboards, the admin console, Google sign-in.

---

# Phase 2: who dialed for whom, attribution and daily counts

## How the phone-number sheet is stored
- **Dated rows, not one big table.** Each row says "this line belonged to this Representative and client from this date to that date". A **week** is Monday to Sunday, a **month** is the whole month, a **day** is one day.
- **Daily uploads are supported** (the sheet after Oct 18 will be uploaded day by day). Weekly, monthly and daily columns can be mixed in one sheet. A heading may be "Week of Oct 12", "Month of October 2026", "Oct 19", "2026-10-19" or an Excel date. **The layout of the daily sheet has not been seen**; the preview shows exactly how every column was read, so check it before saving.
- **The most specific period wins for a day** (a day beats a week beats a month). This replaces the fixed `MONTHLY_ASSIGNMENTS_START = 2026-10-19` cut-off in the prompt: a monthly upload that overlaps earlier weekly dates automatically keeps the weekly data for those dates, and a daily upload for Oct 19 overrides a monthly row for that one day only.
- **An upload replaces whole periods, never more.** Re-uploading the week of Oct 12 replaces that week (including numbers that were removed); other weeks are untouched. Nothing is deleted: replaced rows are marked, so **rolling an upload back** brings them back. Uploading the same file twice saves nothing.
- **A preview comes first** (what is added, replaced, removed, per period). It blocks on: an unknown Representative or client, a line on two clients in the same period, an unreadable cell. It warns (without blocking) about a line shared by two Representatives and about two numbers whose clients swap places between periods (reported, never corrected).
- A sheet may name the agent (Purbasha Sarkar) instead of the working name (Phoebe); it is stored under the Representative.
- **Standing fallbacks** (the legacy overrides: Albert, Albert 2 and Scott as Kutlerri lines, Dave's (940) 245-4087 as Cedar's, Dave's (929) 521-6672 as Eight Turn Crepe for the week of Sep 7) only fill gaps; any sheet row for the day wins. The prototype's phone list already has these merged in as ordinary weekly rows, so it was loaded as-is and the overrides were added underneath.
- What is missing: turning an uploaded xlsx or csv file into rows of cells, and the upload screen. They arrive with the admin console in Phase 4. The save, preview and rollback logic and its endpoints (`/api/admin/assignments/*`, taking the sheet as rows of cells) are done and tested.

## Which Representative and client a call belongs to
1. The call's phone line and **shift day** find the assignment (most specific period wins).
2. A line listed for two Representatives in the same period is decided by the call's **agent**. If the agent is neither (or has no Representative) the call is flagged **Undecided**, not guessed.
3. A line assigned to Kutlerri is **Internal**. A line with no assignment is **Unassigned**. Both are stored and never shown in the three views.
4. **Agent fallback (a decision for you).** For a call on a line that is *not* on the sheet for that day, the prototype counts it for the agent's Representative's client when that is clear, and the prototype's numbers depend on it (the written spec says such a call is simply Unassigned). The rule, which reproduces every one of the prototype's 49,971 client calls with the same client and Representative:
   - if the Representative dialed from listed lines of exactly one client that same shift day, that client;
   - otherwise, if the sheet gives them exactly one customer client (Kutlerri's own lines ignored), that client;
   - otherwise Unassigned.

   It is the setting `agentFallback` (on by default so the numbers match the prototype). Dave's (346) 423-3909 and (682) 356-3013 are listed in `agentFallbackExcludedLines` so they stay Unassigned, as the prompt says. The status page reports how many calls were counted this way (2,640 so far) and on which lines, so the sheet can be completed.

## Daily counts
`daily_rollups` holds, per shift day, client, Representative, agent and line: calls, meaningful conversations (a connect longer than 90 seconds), MQLs over 90 seconds, and a count per disposition (plus "no disposition" and "unrecognised text"). Only calls that belong to a client are counted. They are rebuilt for the affected days after every calls sync, after an upload or rollback, and after a time rule changes.

## Acceptance results (shift days 2026-08-17 to 2026-10-09, client lines)
Run with `npx tsx src/scripts/acceptance.ts "<prototype HTML>"`.

| | Prompt | Counting only calls the workbook also has | Everything the API has |
|---|---|---|---|
| Total dials | 49,971 | **49,971** | 50,944 (+973) |
| Dials per client (all six) and the Sep 10 shift (274) | | **exact** | higher by the extra calls |
| Connects | 4,160 | 4,168 (+8) | 4,242 |
| Meaningful conversations | 1,538 | 1,541 (+3) | 1,563 |
| MQLs (over 90 s / 90 s or less) | 1,023 (828 / 195) | 1,024 (829 / 195) | 1,039 |

Every one of the prototype's 49,971 client calls is in the data with the **same client and the same Representative**. The differences are two data differences, not rule differences:
1. **+8 connects, +3 meaningful, +1 MQL:** 13 calls received a disposition after the prototype's 13 Oct snapshot (8 became connects). The API holds the newer values.
2. **+973 calls (1.9%) that are in the API but not in the workbook.** 83% last 0 seconds, and 83% were to a contact the same line had already called in the previous 14 days (40% for ordinary calls), which is what call-backs from prospects look like. **The API has no direction field**, so inbound or missed calls cannot be told apart from outbound ones, and the prompt says only outbound calls count. **This needs a decision**; no filter was guessed.

## Known sheet issues, as expected
- **Andrew's two numbers swap clients** between the weeks of Sep 21 and Sep 28 (…2756 and …9521). Imported as written; reported when the sheet is previewed.
- **One shared line:** …0261 in the week of Sep 7 is listed for Dave and Hiya (both Rasa); calls follow the agent.
- **Calls after the sheet ends** (from Oct 12) have no client until the next sheet is uploaded. The status page says how many and on which lines.
