# secret-party-sync — Full Project Context

## What this is

A Cloudflare Worker that syncs ticket, add-on, and invitation data from the **Secret Party API** into **Airtable**. The goal is to keep Airtable (the team's operational database) up to date with whatever is happening in Secret Party (the ticketing platform) without manual data entry.

The active event is **Room Service '26** — Secret Party event ID `Jk6YADb6a3`.

---

## Current State (as of August 2026)

- Worker syncs invitations and tickets/add-ons every 5 minutes, incrementally, via a keyset cursor
- Bound to **one Secret Party event at a time** via `ACTIVE_EVENT_ID` in `wrangler.toml` — records from any other event are ignored
- Invitations syncing into **`Invitations`** (`tblKgwXnpqWjf8Z8q`) — 10,014 records loaded for RS'26
- Tickets syncing into **`RS'26 Tix`** (`tblVGGdO9QrRYi50x`) — Secret Party currently has **0** tickets for this event (sales not open)
- Add-ons syncing into **`RS'26 Add-Ons`** (`tblgcN9VlJ4jT5R2h`) — 0 from Secret Party for this event
- All Airtable writes use field IDs and table IDs — immune to field/table renames
- Every run appends a row to `{{Sync State}}`, **including runs that fail**
- A run that can't finish its window inside the subrequest budget reports `partial` and resumes next run
- `GET /status` reports staleness and backlog for external health checks
- GitHub auto-deploy: push to `main` = deployed

---

## The Big Picture

Secret Party is the source of truth for tickets, add-ons, and invitations. Airtable is where the team does all their work — tracking attendees, sponsors, wristbands, logistics. This worker bridges the two by:

1. Running automatically every 5 minutes (cron)
2. Available to trigger manually via an Airtable button automation

Per run: `/tickets` is fetched once and split into tickets and add-ons, then `/invitations` is fetched once. Two Secret Party calls per run.

---

## ⚠️ Event Rollover Checklist

**Read this before starting a new event cycle.** Getting it wrong is what caused the August 2026 outage.

The team reuses this base across events: archive the old data, rename the tables, keep the cross-base links. Secret Party rolls over separately, by issuing a new API key scoped to the new event. Those two things must be kept in step.

Do these together, in one change:

1. **Rotate `SECRET_PARTY_API_KEY`** to the new event's key.
   `npx wrangler secret put SECRET_PARTY_API_KEY` — or the Cloudflare dashboard, but see the deploy note below.
2. **Update `ACTIVE_EVENT_ID`** in `wrangler.toml` to the new event's ID.
   Find it with: `curl -s https://api.secretparty.io/secret/invitations -H "Authorization: Bearer <new key>" | jq -r '.data[0].event_id'`
3. **Reset the cursors.** Append one row to `{{Sync State}}` per endpoint (`invitations`, `tickets/add-ons`) with `Cursor` blank, or delete the old rows. A missing cursor means a full sync, which the Worker can now survive.
4. **Confirm the table IDs in `src/config.js`** still point where you want. The IDs are stable across renames — the comments beside them are not, and will drift.
5. **Push to `main`** so steps 2 and 4 actually deploy.
6. **Bulk-load the new invitations** rather than waiting on the cron:
   `node --env-file=.dev.vars src/backfill-invitations.js --set-cursor`
7. **Check `GET /status`** returns `healthy: true`.

Why `ACTIVE_EVENT_ID` matters: if you clear a table for the new cycle while the API key still points at the old event, every old record Secret Party touches gets re-created in Airtable, one cron tick at a time. That is exactly how 112 Big Stick Shindig rows reappeared in `RS'26 Tix` in July 2026. The event filter makes that impossible.

---

## Deployment

| | |
|---|---|
| **Worker URL** | https://secret-party-sync.dangles.workers.dev |
| **Cloudflare account** | dangles@take3presents.com |
| **Account ID** | e5344b6ea83eafd3e476f25942d8326c |
| **Cloudflare plan** | Free — **50 subrequests per invocation** |
| **Cron** | `*/5 * * * *` |
| **Deploy** | Push to `main` on GitHub — do NOT run `npm run deploy` |
| **Check auth** | `npx wrangler whoami` |
| **Tail live logs** | `npx wrangler tail` |
| **Run tests** | `npm test` |

### GitHub + Auto-deploy

- **Repo:** https://github.com/Take3Presents/secret-party-sync (private)
- Every push to `main` triggers `.github/workflows/deploy.yml`, which deploys via `cloudflare/wrangler-action@v3`
- **GitHub secret required:** `CLOUDFLARE_API_TOKEN` — already set

**Do not edit the Worker in the Cloudflare dashboard.** A dashboard change on 2026-07-29 rotated `SECRET_PARTY_API_KEY` without a matching commit, so the repo no longer described what was running and the event rollover left no trace in git. Secrets set via `wrangler secret put` are fine — they don't create a code version. Anything that changes behaviour goes through a commit.

---

## Secrets and Vars

Secrets are set as Cloudflare Worker secrets. Local values live in `.dev.vars` (gitignored). Secrets **cannot be read back** from Cloudflare once set — `.dev.vars` is the only copy.

| Secret | Purpose |
|---|---|
| `SECRET_PARTY_API_KEY` | Scoped to a single Secret Party event. Rotating it repoints the sync. |
| `AIRTABLE_API_KEY` | Worker's Airtable PAT |
| `WEBHOOK_SECRET` | Guards `POST /sync` and `GET /status` |

Vars live in `wrangler.toml` under `[vars]` and are committed:

| Var | Purpose |
|---|---|
| `ACTIVE_EVENT_ID` | The Secret Party event this sync is bound to. Records from other events are counted and dropped. |

---

## Airtable Setup

| | |
|---|---|
| **Base ID** | `appgvcig9jwAhim6W` (Sponsorship & Ticketing) |
| **Tickets table** | `RS'26 Tix` (`tblVGGdO9QrRYi50x`) |
| **Add-Ons table** | `RS'26 Add-Ons` (`tblgcN9VlJ4jT5R2h`) |
| **Invitations table** | `Invitations` (`tblKgwXnpqWjf8Z8q`) |
| **Sync State table** | `{{Sync State}}` (`tblT06K1k450mZ6q2`) |

Table names change every cycle; the IDs don't. `src/config.js` uses IDs everywhere.

### `{{Sync State}}` table fields

Every run appends one row per endpoint. Append-only log.

| Field | Type | Purpose |
|---|---|---|
| `Endpoint` | text | `invitations` or `tickets/add-ons` |
| `Cursor` | text | Keyset position for the NEXT run — `<updated_at>\|<id>` |
| `Triggered By` | single select | `scheduled` or `manual` |
| `Synced At` | dateTime | When this run happened (UTC) |
| `Status` | single select | `success` / `partial` / `failed` |
| `Error` | text | Error message, or the reason a run was partial |
| `Records Fetched` | number | Size of the window this run was working through |
| `Backlog Remaining` | number | Records still queued after this run. `0` on a healthy run. |
| `Skipped (Other Event)` | number | Records dropped for belonging to a different event |
| `Tickets Created` / `Tickets Updated` | number | Writes to the tickets table |
| `Add-Ons Created` / `Add-Ons Updated` | number | Writes to the add-ons table |
| `Invitations Created` / `Invitations Updated` | number | Writes to the invitations table |

**Do not delete every row for an endpoint.** `getCursor` reads the most recent row carrying a cursor; if there isn't one, the next run does a full sync. That's survivable now, but it means hours of needless re-reading.

### Merge keys

| Table | Merge field | Field ID |
|---|---|---|
| `RS'26 Tix` | `SP ID` | `fldq44PIoUKPDHh6m` |
| `RS'26 Add-Ons` | `SP ID` | `fldP1ir0aTTKnE4bx` |
| `Invitations` | `SP ID` | `fldFBesn9Xnq5TM3d` |

Field mappings for all three live in `src/config.js` under `FIELD_MAP`, with the Airtable field name in a comment beside each ID.

**Fields not written by sync** (manually managed): `Email`, `Invited By Email` (linked records), `Promo Code` (multipleSelects — use `SP Promo Code`), `Transfer From Name`, `Transferred From Email`.

---

## How the Sync Works

### Entry points (`src/index.js`)
- **Cron:** `scheduled()` → `runSync(env, 'scheduled')`
- **`POST /sync`:** manual trigger, requires `x-webhook-secret`
- **`GET /status`:** health check, requires `x-webhook-secret`. Returns per-endpoint `minutesAgo`, `status`, `backlog`, and an overall `healthy` boolean (false if either endpoint is >20 minutes stale or failed).

### Core flow (`src/sync.js`)

`runSync()` runs `tickets/add-ons` first, then `invitations`. Each is wrapped so a failure in one cannot stop the other.

Per endpoint:
1. Read the cursor from `{{Sync State}}`
2. Fetch the endpoint from Secret Party using the cursor's timestamp half
3. Re-filter and sort client-side into a *window* of records genuinely newer than the cursor
4. Walk the window in slices of 10, upserting each slice, until the window is done or the budget runs out
5. Advance the cursor to the last record actually written
6. Append a `{{Sync State}}` row

### Subrequest budget (`src/budget.js`)

The free plan allows **50 outbound fetches per invocation** and every Secret Party and Airtable call spends one. The budget object enforces this, and reserves the `{{Sync State}}` write up front so a run can always report itself — the August 2026 outage was invisible for three days precisely because the failure log needed a subrequest it no longer had.

Allocation per run: 48 usable (2 held as retry headroom) − 2 log writes − 2 cursor reads − 2 Secret Party fetches = **42 upsert requests**, or ~420 records. Tickets are capped at half so a large invitation backlog can't starve ticket sales; invitations get the rest plus whatever tickets didn't use.

### Cursor (`src/cursor.js`)

A cursor is a keyset position ordered by `(updated_at, id)`, stored as `2026-08-03T00:18:06.000Z|yV5Mq1e15j`.

**The id half is load-bearing.** Secret Party bulk-loads invitations, so the RS'26 set of 10,014 records has only **three distinct `updated_at` values — the largest tie is 5,557 records**. A timestamp-only cursor cannot stop halfway through a tie: advancing past the timestamp silently drops the rest of it, and not advancing means no progress at all. Ordering by id as a tiebreak lets a run stop anywhere and resume exactly where it left off.

**The cursor only ever advances to a record that was actually written.** There is no path that steps over unprocessed records. An empty window leaves the cursor untouched — the old "+1 second nudge" was removed, because with a client-side keyset filter it wasn't needed and could skip records landing inside the nudged-over second.

### Event filter

Every record is checked against `ACTIVE_EVENT_ID` before it is written. Invitations carry `event_id` directly; tickets and add-ons carry it on their nested `invitation`. A record whose event can't be determined is **kept**, not dropped — so a shape change upstream degrades to the old behaviour rather than silently syncing nothing. Skipped records still let the cursor advance past them, so a window that's entirely another event can't wedge the sync.

---

## Testing

`npm test` runs `test/simulate.mjs`. It pulls the real Secret Party dataset once, then replaces Airtable with an in-memory fake and drives `runSync()` repeatedly, exactly as the cron would. It asserts:

- the 50-subrequest cap is never exceeded on any run
- a `{{Sync State}}` row is written on every run, including failing ones
- the backlog strictly drains
- every in-event record lands exactly once — nothing skipped, nothing duplicated
- out-of-event records are never written
- an Airtable 502 storm mid-run loses no records once it recovers

Scenarios covered: cold start with the full 10,014-record backlog (drains in 24 runs, ~2 hours), an Airtable outage partway through, and a mixed-event dataset.

---

## Scripts

| Script | Purpose |
|---|---|
| `src/backfill-invitations.js` | Load every invitation for `ACTIVE_EVENT_ID`. Runs in Node, so no subrequest cap. `--dry-run`, `--event <id>`, `--set-cursor`. |
| `src/backfill-addons.js` | Same for add-ons |
| `src/backfill.js` | Patches SP fields onto existing ticket rows by matching Ticket Code / SP ID |
| `scripts/audit-stale.mjs` | Finds rows whose SP ID the current API key no longer returns — i.e. leftovers from a previous event. Writes `tmp/stale-tickets.csv`. `--delete-invitations` to clean up. |

Use the backfill scripts for bulk loads. The Worker will get there on its own, but at ~420 records per 5 minutes.

---

## Manual Sync (Airtable Button)

**Endpoint:** `POST https://secret-party-sync.dangles.workers.dev/sync`
**Required header:** `x-webhook-secret: <WEBHOOK_SECRET>`

```bash
curl -X POST https://secret-party-sync.dangles.workers.dev/sync \
  -H "x-webhook-secret: <WEBHOOK_SECRET>"

curl -s https://secret-party-sync.dangles.workers.dev/status \
  -H "x-webhook-secret: <WEBHOOK_SECRET>" | jq
```

### Airtable automation script

```javascript
const webhookSecret = await input.secret('webhookSecret');

const response = await fetch('https://secret-party-sync.dangles.workers.dev/sync', {
    method: 'POST',
    headers: { 'x-webhook-secret': webhookSecret },
});

if (!response.ok) {
    console.log('Error: ' + response.status + ' ' + await response.text());
    return;
}

const result = await response.json();

if (result.ok) {
    const { invitations, tickets } = result.summary;
    console.log('Invitations — ' + invitations.status + ': created ' + invitations.created + ', updated ' + invitations.updated + ', backlog ' + invitations.backlog);
    console.log('Tickets — ' + tickets.status + ': created ' + tickets.ticketsCreated + ', updated ' + tickets.ticketsUpdated + ', backlog ' + tickets.backlog);
    console.log('Add-Ons — created ' + tickets.addonsCreated + ', updated ' + tickets.addonsUpdated);
} else {
    console.log('Sync failed: ' + result.error);
}
```

**Notes on Airtable scripting:**
- `input.secret()` is the correct API — NOT `input.config.text()`
- `output.text()` does NOT work in automation scripts — use `console.log()`
- `input`, `output`, `console` are global — no imports

### Recommended: a staleness alert

The sync now reports its own health, but nothing watches it. Worth adding an Airtable automation on `{{Sync State}}`: "when a record is created, if `Status` is not `success` or `Backlog Remaining` > 0, notify #ops". Plus a scheduled daily check that the newest `Synced At` is within the last 20 minutes — that's the case a per-record trigger can't catch, because a dead sync writes nothing at all.

---

## File Structure

```
src/
  index.js                — Worker entry. scheduled(), POST /sync, GET /status
  sync.js                 — runSync(), syncEndpoint(), processWindow(), mapRecord()
  budget.js               — Subrequest budget with reservations
  cursor.js               — Keyset cursor: parse/format/compare/window
  airtable.js             — upsertBatch(), getCursor(), getLatestRuns(), logSync()
  secretparty.js          — fetchRecords()
  config.js               — BASES, TABLES, MERGE_FIELDS, SYNC_STATE_FIELDS, FIELD_MAP, limits
  backfill.js             — Ticket field backfill
  backfill-invitations.js — Bulk invitation load
  backfill-addons.js      — Bulk add-on load
scripts/
  audit-stale.mjs         — Find/clean rows from a previous event
test/
  simulate.mjs            — Offline simulation of the cron loop
wrangler.toml             — Cron schedule, compat flags, ACTIVE_EVENT_ID
.dev.vars                 — Local secrets (gitignored — DO NOT COMMIT)
```

---

## Secret Party API Reference

Base URL: `https://api.secretparty.io/secret`

| Endpoint | Description |
|---|---|
| `GET /tickets` | All tickets and add-ons. Supports `?updated_after=ISO8601` |
| `GET /invitations` | All invitations. Supports `?updated_after=ISO8601` |

Response shape:
```json
{
  "data": [ ...records ],
  "meta": { "updated_after": "...", "next_updated_after": "...", "returned_count": 123 }
}
```

Secret Party returns ALL matching records in one response — no pagination. With no cursor, that's the full dataset for the event the API key is scoped to.

**Cursor behaviour:**
- `updated_after` is inclusive, and a few records come back regardless of the cursor (see Known Bugs). Always re-filter client-side.
- `next_updated_after` echoes your input when nothing changed, and has been observed returning a value *earlier* than the cursor sent. It is not trusted — the sync derives its own cursor from records it wrote.
- All timestamps are ISO-8601, second precision.
- Treat all records as upserts keyed on `id`.

### Invitation fields

| SP field | Type | Airtable field | Notes |
|---|---|---|---|
| `id` | string | `SP ID` | merge key |
| `event_id` | string | — | not stored; used for the event filter |
| `code` | string | `Invite Code` | |
| `first_name` / `last_name` | string\|null | `First Name` / `Last Name` | |
| `email` / `phone` | string\|null | `Email` / `Phone` | |
| `stage` | string | `SP Stage` | added/pending/sending/sent/opened/viewed/purchased/bounced/rejected/spam/opted-out/cancelled/duplicate/transferred |
| `status` | string | `SP Status` | active/purchased |
| `level` | number | `SP Level` | stored as text (Airtable field is singleLineText) |
| `invites_per` | number\|null | `SP Invites Per` | |
| `view_count` | number | `SP View Count` | |
| `created_invitation_count` | number | `SP Created Invitation Count` | |
| `claimed_ticket_count` | number | `SP Claimed Ticket Count` | |
| `last_viewed_at` / `created_at` / `updated_at` | string | `SP Last Viewed At` / `SP Created At` / `SP Updated At` | |
| `inviter_email` | string\|null | `Invited By Email` | |
| `inviter.name` | string | `SP Inviter Name` | nested |
| `parent_invitation.id` / `.code` | string | `SP Parent Invitation ID` / `Code` | nested |
| `tickets[]` | array | `SP Tickets` | JSON in multilineText |

### Ticket / Add-On fields

Both share the same shape; `product.type` distinguishes them (`ticket` vs anything else).

| SP field | Type | Airtable field | Notes |
|---|---|---|---|
| `id` | string | `SP ID` | merge key |
| `code` | string\|null | `Ticket Code` / `Add-on Code` | |
| `invitation_code` / `invitation_id` | string | `Invitation Code` / `SP Invitation ID` | |
| `first_name` / `last_name` | string\|null | `First Name` / `Last Name` (tickets), `SP First/Last Name` (add-ons) | |
| `email` / `phone` | string\|null | `Email from SP` / `Phone` | |
| `stage` | string | `SP Stage` | |
| `status` | string | `SP Status` | active/pending/refunded/transferred/disputed |
| `invites_per` | number\|null | `SP Invites Per` | |
| `purchase_price`, `surcharge_fee`, `service_fee`, `processing_fee`, `total` | string | `SP ...` | decimal strings, e.g. `"0.01"` |
| `transfer_fee` | string | `SP Transfer Fee` | |
| `transfer_requires_payment` | boolean\|null | `SP Transfer Requires Payment` | checkbox |
| `transfer_status` | string\|null | `SP Transfer Status` | pending/active/complete |
| `transferee_*` / `transferer_*` | string\|null | `SP Transferee ...` / `SP Transferer ...` | |
| `sales_organizer_revenue_amount` | string\|null | `SP Sales Organizer Revenue` | |
| `is_checked_in` | boolean | `SP Is Checked In` | checkbox |
| `checkin_updated_at` | string\|null | `SP Checkin At` | |
| `total_unlocked_by_count` | number | `SP Total Unlocked By Count` | |
| `promotion_code` | string | `SP Promo Code` | |
| `created_at` / `updated_at` | string | `SP Created At` / `SP Updated At` | |
| `product.name` / `.type` / `.is_transfer_allowed` | — | `SP Product Name` / `Type` / `Transfer Allowed` | nested |
| `invitation` | object | `SP Invitation` | JSON in multilineText; also the source of `event_id` for the event filter |
| `product_id` | string | — | not mapped |

---

## Known Bugs / Quirks

### Secret Party returns records regardless of the cursor
A handful of records come back on every incremental fetch even when the cursor is set past their `updated_at`, and `next_updated_after` has been seen returning a value *earlier* than the cursor sent.

**Mitigation:** every response is re-filtered client-side against the stored keyset cursor (`src/cursor.js`). Stale records fail the check and are dropped before any write. This is a Secret Party bug, not ours.

### Almost all invitations share one timestamp
Secret Party bulk-creates invitations, so `updated_at` is near-useless as a unique ordering key — the RS'26 load has 10,014 records across 3 distinct values. This is why the cursor is a keyset on `(updated_at, id)` rather than a plain timestamp. Don't "simplify" it back.

---

## Known Gotchas

- **All Airtable writes use field IDs and table IDs.** Renames in Airtable won't break the sync. Field IDs are in `src/config.js` with name comments — the comments drift, the IDs don't.
- **Airtable 403 `INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND` with a valid token** is usually not a permissions error — it's Airtable failing to resolve a table or field **by name**. Fix: use the ID.
- **`SP ID` must stay plain text or number** — `performUpsert` won't work on formula, lookup, or rollup fields.
- **Airtable counts matched records as "updated"** even when nothing changed, so log counts ≠ actual data changes.
- **`null` / `undefined` SP fields are skipped** — `mapRecord()` only writes fields with a value, so Secret Party can't blank out a manual edit.
- **`performUpsert` creates when no match is found.** If `SP ID` is blank on a row, every sync creates a duplicate. And if rows are *deleted* while Secret Party still returns them, the sync re-creates them — which is what `ACTIVE_EVENT_ID` now guards against.
- **50 subrequests per invocation on the free plan.** Even the paid plan's 1,000 wouldn't cover a 10,014-record window (1,004 needed), so the answer is chunked progress, not a bigger plan.
- **Secrets are write-only in Cloudflare** — `.dev.vars` is the only copy.
- **Deploy through GitHub, not the dashboard.** Dashboard edits leave no trace in git.

---

## History

1. Built worker from scratch with cron + webhook trigger; deployed to Cloudflare free plan
2. First sync created duplicates — existing rows had no `SP ID` so upsert couldn't match them
3. `backfill.js` stamped SP IDs onto existing rows by matching Ticket Code / Invitation Code
4. Added `{{Sync State}}`; moved the cursor onto the log row (one unified row per run)
5. Added client-side cursor filtering to kill the phantom "Tickets Updated: 2" noise
6. Full SP field coverage for invitations and tickets; objects/arrays stored as JSON
7. Switched tickets to the production table; retired `{{API TEST}}`
8. Switched all Airtable references to field IDs and table IDs
9. Added add-ons sync — `/tickets` fetched once and split by `product.type`
10. **2026-07-29** — `SECRET_PARTY_API_KEY` rotated via the Cloudflare dashboard for the Room Service '26 rollover. No code change, no cursor reset, no commit.
11. **2026-08-03** — 10,014 RS'26 invitations bulk-loaded into Secret Party. See the incident below.
12. **2026-08-06** — subrequest budget, keyset cursor, event filter, per-endpoint isolation, guaranteed log write, `partial` status, `GET /status`, and the simulation test suite

### Incident: 2026-08-03 → 2026-08-06

Three and a half days of silent failure. Worth understanding, because every fix above traces back to it.

**What happened.** At `2026-08-03T00:18` Secret Party bulk-created 10,014 invitations for the new event. The next cron run fetched all of them — the cursor was still parked on the old event, so everything looked new — and tried to upsert them at 10 per batch: 1,002 Airtable requests against a 50-subrequest budget. It wrote exactly 480 records (2 fixed calls + 48 batches = 50) and then threw.

**Why nobody noticed.** The failure handler's own `{{Sync State}}` write also needed a subrequest, and there wasn't one left. So the run died writing nothing at all. The log simply stopped, which looks identical to a healthy idle sync. The single `failed` row that does exist, on 2026-08-05, is from the one run where Airtable happened to return a 502 *early* enough to leave budget for the log write.

**Why it never recovered.** The cursor is only advanced after a successful run, so every subsequent run re-fetched the same 10,014 records and failed at the same place. ~1,000 identical failures.

**What it masked.** `runSync` called invitations before tickets and let the exception propagate, so the ticket sync didn't run for the entire period either.

**The separate July problem.** When the tables were cleared for the new cycle, the API key still pointed at Big Stick Shindig 2026. Each time Secret Party touched an old ticket, the next cron picked it up, found no matching `SP ID`, and re-created the row. 112 BSS'26 tickets came back that way across July 5–12 — only 112, because those were the only ones Secret Party modified after the wipe. `ACTIVE_EVENT_ID` exists to make this impossible.

**Fixes.** Subrequest budget with a reserved log write; keyset cursor so a huge window drains across runs; per-endpoint isolation; retry on transient Airtable errors; `partial` status and `Backlog Remaining` so a struggling sync is visible; `GET /status` for external monitoring; the event filter; and a test suite that replays all of it offline.

---

## Airtable Access

**1. Airtable MCP tool (preferred when available)**
Configured globally in `~/.claude/mcp.json` against `https://mcp.airtable.com/mcp` with its own PAT. Tools appear as `mcp__airtable__*`. Note this PAT is different from the Worker's.

**2. Direct REST API**
The Worker's `AIRTABLE_API_KEY` works directly against `https://api.airtable.com/v0/<baseId>/<tableId>`, and the metadata API at `https://api.airtable.com/v0/meta/bases/<baseId>/tables` is the fastest way to check what a table is currently called.
