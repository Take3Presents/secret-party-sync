# secret-party-sync — Claude Context

## What this project is
A Cloudflare Worker that syncs data from the Secret Party API into Airtable on a cron schedule (every 5 minutes). It can also be triggered manually via an HTTP webhook (used by an Airtable automation button).

## Deployment
- **Worker URL:** https://secret-party-sync.dangles.workers.dev
- **Cloudflare account:** dangles@take3presents.com
- **Workers plan:** Free (50 subrequest limit per invocation)
- **Cron:** `*/5 * * * *` — running and active
- **Deploy command:** `npm run deploy`

## Secrets
All secrets are stored as Cloudflare Worker secrets (set via `wrangler secret put`).
Local values are in `.dev.vars` (gitignored — do not commit).

| Secret | Description |
|--------|-------------|
| `SECRET_PARTY_API_KEY` | Secret Party API key |
| `AIRTABLE_API_KEY` | Airtable personal access token |
| `WEBHOOK_SECRET` | Secures the manual /sync endpoint |

Current `WEBHOOK_SECRET` value: `1a13a3267608b874a6e397b67f62a0711f455f772f512ae2c0ab76a1c69e4f80`

## Airtable setup
- **Base ID:** `appgvcig9jwAhim6W`
- **Tables:**
  - `{{API TEST}}` — invitations and tickets (will be renamed to `BSS'26` / `tblVGGdO9QrRYi50x` for prod)
  - `{{Sync State}}` — stores sync cursors per endpoint (invitations, tickets)
- **Merge key:** `SP ID` field — must be a plain text or number field (not formula/lookup) for upsert to work

## How the sync works
1. Reads cursor from `{{Sync State}}` table (null = full sync)
2. Fetches records from Secret Party API (`/invitations` and `/tickets`) using cursor
3. Maps SP fields → Airtable fields (see `src/config.js` FIELD_MAP)
4. Upserts into Airtable using `performUpsert` on `SP ID` field to prevent duplicates
5. Saves new cursor to `{{Sync State}}`

Invitations and tickets sync in parallel.

## Manual sync (Airtable button)
- **Endpoint:** `POST https://secret-party-sync.dangles.workers.dev/sync`
- **Header required:** `x-webhook-secret: <WEBHOOK_SECRET value>`
- Set up as an Airtable automation: trigger = button clicked, action = run script
- Airtable script uses `input.secret('webhookSecret')` to store the secret securely

### Airtable automation script:
```javascript
const webhookSecret = await input.secret('webhookSecret');

const response = await fetch('https://secret-party-sync.dangles.workers.dev/sync', {
    method: 'POST',
    headers: {
        'x-webhook-secret': webhookSecret,
    },
});

if (!response.ok) {
    const text = await response.text();
    console.log('Error: ' + response.status + ' ' + text);
    return;
}

const result = await response.json();

if (result.ok) {
    console.log('Sync complete!');
    console.log('Invitations — created: ' + result.summary.invitations.created + ', updated: ' + result.summary.invitations.updated);
    console.log('Tickets     — created: ' + result.summary.tickets.created + ', updated: ' + result.summary.tickets.updated);
} else {
    console.log('Sync failed: ' + result.error);
}
```

Secret name in Airtable sidebar: `webhookSecret`

## Known issues / in progress
- **Deduplication issue:** The first sync created duplicates because existing Airtable records didn't have `SP ID` populated. A one-time backfill script (`src/backfill.js`) was created to match existing records to SP IDs via Invitation Code / Ticket Code, then re-run the sync to dedup.
- **Subrequest limit:** Free plan allows 50 subrequests per invocation. With 10 records/batch, this handles ~440 records per run. If it bombs mid-sync the cursor isn't saved so next run retries from the same point safely. Fine for incremental syncs post-backfill.
- **Sync State logging:** Not yet implemented — the `{{Sync State}}` table currently only stores cursors. Need to add sync log rows (timestamp, trigger type, created/updated counts).

## Still to do
- [ ] Add sync logging to `{{Sync State}}` table (timestamp, manual vs scheduled, counts per endpoint)
- [ ] Run backfill script (`src/backfill.js`) to populate SP IDs on existing records, then re-sync to dedup
- [ ] Switch tables from `{{API TEST}}` to production table `BSS'26` (tblVGGdO9QrRYi50x) when ready
- [ ] Verify `SP ID` field type in Airtable is plain text/number (not formula) so upsert works

## File structure
```
src/
  index.js      — Worker entry point (fetch + scheduled handlers)
  sync.js       — Core sync logic (syncEndpoint, runSync)
  airtable.js   — Airtable API helpers (upsertRecords, getCursor, setCursor)
  secretparty.js — Secret Party API fetch helper
  config.js     — Base IDs, table names, field mappings
  backfill.js   — One-time script to backfill SP IDs on existing records
wrangler.toml   — Cloudflare Worker config
.dev.vars       — Local secrets (gitignored)
.dev.vars.example — Template for .dev.vars
```
