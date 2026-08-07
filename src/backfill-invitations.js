/**
 * Backfill script: load every Secret Party invitation into the Invitations table.
 *
 * This runs in Node, not in the Worker, so it isn't bound by Cloudflare's
 * 50-subrequest cap — it is the right tool for the initial load after an event
 * rollover, where the Worker would otherwise take a couple of hours to grind
 * through the backlog five minutes at a time.
 *
 * SP ID is the merge key, so re-running is idempotent.
 *
 * Usage:
 *   node --env-file=.dev.vars src/backfill-invitations.js [options]
 *
 * Options:
 *   --dry-run      Preview without writing anything
 *   --event <id>   Only load records for this Secret Party event
 *                  (defaults to ACTIVE_EVENT_ID in wrangler.toml)
 *   --set-cursor   After a successful load, append a {{Sync State}} row parking
 *                  the cursor at the last record loaded, so the Worker resumes
 *                  incrementally instead of re-reading everything
 *   --help
 */

import { readFileSync } from 'node:fs';
import { BASES, TABLES, MERGE_FIELDS, FIELD_MAP, COERCE_TO_STRING, SYNC_STATE_FIELDS } from './config.js';

const AIRTABLE_API  = 'https://api.airtable.com/v0';
const SP_BASE_URL   = 'https://api.secretparty.io/secret';
const BATCH_SIZE    = 10;   // Airtable max per upsert request
const RATE_LIMIT_MS = 250;  // 4 req/sec — under Airtable's 5/sec limit

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*|^ \* ?/gm, ''));
  process.exit(0);
}

const dryRun    = args.includes('--dry-run');
const setCursor = args.includes('--set-cursor');

/** Read ACTIVE_EVENT_ID out of wrangler.toml so there's one source of truth. */
function eventIdFromWrangler() {
  try {
    const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
    return toml.match(/^\s*ACTIVE_EVENT_ID\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  } catch {
    return null;
  }
}

const eventIdArg = args.indexOf('--event') !== -1 ? args[args.indexOf('--event') + 1] : null;
const eventId = eventIdArg ?? eventIdFromWrangler();

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function mapRecord(spRecord) {
  const map = FIELD_MAP.invitations;
  const fields = {};
  for (const [spField, airtableField] of Object.entries(map)) {
    const value = spField.includes('.')
      ? spField.split('.').reduce((obj, key) => obj?.[key], spRecord)
      : spRecord[spField];
    if (value !== undefined && value !== null) {
      if (COERCE_TO_STRING.has(airtableField)) {
        fields[airtableField] = String(value);
      } else if (typeof value === 'object') {
        fields[airtableField] = JSON.stringify(value, null, 2);
      } else {
        fields[airtableField] = value;
      }
    }
  }
  return { fields };
}

async function upsertBatch(apiKey, baseId, tableId, batch, batchNum, totalBatches) {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(`${AIRTABLE_API}/${baseId}/${encodeURIComponent(tableId)}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: batch,
        performUpsert: { fieldsToMergeOn: [MERGE_FIELDS.invitations] },
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return {
        created: data.createdRecords?.length ?? 0,
        updated: data.updatedRecords?.length ?? 0,
      };
    }

    const body = await response.text();
    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < maxAttempts) {
      const backoff = attempt * 2000;
      console.warn(`  Batch ${batchNum}: ${response.status}, retrying in ${backoff / 1000}s...`);
      await sleep(backoff);
      continue;
    }
    throw new Error(`Airtable upsert error on batch ${batchNum}/${totalBatches} (attempt ${attempt}): ${response.status} — ${body}`);
  }
}

/** Same ordering the Worker's cursor uses — see src/cursor.js. */
function compareRecords(a, b) {
  if (a.updated_at !== b.updated_at) return a.updated_at < b.updated_at ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const SP_API_KEY = process.env.SECRET_PARTY_API_KEY;
const AT_API_KEY = process.env.AIRTABLE_API_KEY;

if (!SP_API_KEY || !AT_API_KEY) {
  console.error('Error: Missing SECRET_PARTY_API_KEY or AIRTABLE_API_KEY env vars');
  console.error('Run with: node --env-file=.dev.vars src/backfill-invitations.js');
  process.exit(1);
}

console.log('='.repeat(64));
console.log(`Target table : ${TABLES.invitations}`);
console.log(`Base ID      : ${BASES.invitations}`);
console.log(`Merge key    : SP ID (${MERGE_FIELDS.invitations})`);
console.log(`Event filter : ${eventId ?? 'none — loading every event'}`);
console.log(`Mode         : ${dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
console.log('='.repeat(64));

console.log('\nFetching all Secret Party invitations...');
const spResponse = await fetch(`${SP_BASE_URL}/invitations`, {
  headers: { Authorization: `Bearer ${SP_API_KEY}` },
});
if (!spResponse.ok) throw new Error(`SP API error: ${spResponse.status} ${spResponse.statusText}`);
const spBody = await spResponse.json();
const allRecords = spBody.data ?? spBody.records ?? spBody.invitations ?? [];
console.log(`  ${allRecords.length} invitations returned`);

const spRecords = (eventId ? allRecords.filter((r) => r.event_id === eventId) : allRecords)
  .sort(compareRecords);

if (eventId && spRecords.length !== allRecords.length) {
  console.log(`  ${allRecords.length - spRecords.length} skipped (different event)`);
}

if (spRecords.length === 0) {
  console.log('Nothing to load. Exiting.');
  process.exit(0);
}

const mapped = spRecords.map(mapRecord);
const last = spRecords[spRecords.length - 1];
const cursor = `${last.updated_at}|${last.id}`;

if (dryRun) {
  console.log(`\nDRY RUN — would upsert ${mapped.length} records. First 3:`);
  mapped.slice(0, 3).forEach((r) => console.log(JSON.stringify(r, null, 2)));
  console.log(`\nWould park the cursor at: ${cursor}`);
  process.exit(0);
}

const batches = [];
for (let i = 0; i < mapped.length; i += BATCH_SIZE) batches.push(mapped.slice(i, i + BATCH_SIZE));

console.log(`\nUpserting ${mapped.length} records in ${batches.length} batches of ${BATCH_SIZE}...`);

let totalCreated = 0;
let totalUpdated = 0;

for (let i = 0; i < batches.length; i++) {
  const result = await upsertBatch(AT_API_KEY, BASES.invitations, TABLES.invitations, batches[i], i + 1, batches.length);
  totalCreated += result.created;
  totalUpdated += result.updated;
  if ((i + 1) % 25 === 0 || i === batches.length - 1) {
    console.log(`  ${i + 1}/${batches.length} batches — created ${totalCreated}, updated ${totalUpdated}`);
  }
  if (i < batches.length - 1) await sleep(RATE_LIMIT_MS);
}

console.log('\n' + '='.repeat(64));
console.log('Backfill complete.');
console.log(`  Created : ${totalCreated}`);
console.log(`  Updated : ${totalUpdated}`);
console.log(`  Total   : ${totalCreated + totalUpdated}`);

if (setCursor) {
  const f = SYNC_STATE_FIELDS;
  const response = await fetch(`${AIRTABLE_API}/${BASES.syncState}/${encodeURIComponent(TABLES.syncState)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AT_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      records: [{
        fields: {
          [f.endpoint]:           'invitations',
          [f.triggeredBy]:        'manual',
          [f.syncedAt]:           new Date().toISOString(),
          [f.status]:             'success',
          [f.cursor]:             cursor,
          [f.recordsFetched]:     spRecords.length,
          [f.backlogRemaining]:   0,
          [f.skippedOtherEvent]:  allRecords.length - spRecords.length,
          [f.invitationsCreated]: totalCreated,
          [f.invitationsUpdated]: totalUpdated,
          [f.error]:              'Loaded by src/backfill-invitations.js --set-cursor',
        },
      }],
    }),
  });
  if (!response.ok) throw new Error(`Failed to write cursor row: ${response.status} — ${await response.text()}`);
  console.log(`  Cursor  : ${cursor} (written to {{Sync State}})`);
} else {
  console.log(`\nCursor NOT written. The Worker will re-read all ${spRecords.length} records.`);
  console.log(`Re-run with --set-cursor, or park it manually at: ${cursor}`);
}
