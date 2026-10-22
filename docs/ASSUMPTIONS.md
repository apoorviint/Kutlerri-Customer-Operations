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
