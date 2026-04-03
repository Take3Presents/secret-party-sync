/**
 * Backfill script: fetch all SP invitations and upsert into "Current Invite List".
 *
 * Unlike the ticket backfill (which matches existing records), this script upserts
 * directly — safe to run on an empty table or re-run for idempotency. SP ID is the
 * merge key so re-runs won't create duplicates.
 *
 * Usage:
 *   node --env-file=.dev.vars src/backfill-invitations.js [--dry-run]
 *
 * Options:
 *   --dry-run   Preview first 5 records without writing anything
 *   --help      Show this message
 */

import { BASES, TABLES, FIELD_MAP } from './config.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const SP_BASE_URL  = 'https://api.secretparty.io/secret';
const BATCH_SIZE   = 10;    // Airtable max per upsert request
const RATE_LIMIT_MS = 250;  // 4 req/sec — under Airtable's 5/sec limit
const MERGE_FIELD  = 'SP ID';

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log(`
Usage: node --env-file=.dev.vars src/backfill-invitations.js [--dry-run]

  --dry-run   Preview first 5 records without writing to Airtable
`);
  process.exit(0);
}

const dryRun = args.includes('--dry-run');

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapRecord(spRecord) {
  const map = FIELD_MAP.invitations;
  const fields = {};
  for (const [spField, airtableField] of Object.entries(map)) {
    const value = spField.includes('.')
      ? spField.split('.').reduce((obj, key) => obj?.[key], spRecord)
      : spRecord[spField];
    if (value !== undefined && value !== null) {
      // SP Level is a singleLineText field in Airtable but SP returns it as a number
      if (airtableField === 'SP Level') {
        fields[airtableField] = String(value);
      // Objects and arrays are stored as JSON in multilineText fields
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
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(`${AIRTABLE_API}/${baseId}/${encodeURIComponent(tableId)}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        records: batch,
        performUpsert: { fieldsToMergeOn: [MERGE_FIELD] },
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const created = data.createdRecords?.length ?? 0;
      const updated = data.updatedRecords?.length ?? 0;
      console.log(`  Batch ${batchNum}/${totalBatches} — created: ${created}, updated: ${updated}`);
      return { created, updated };
    }

    const err = await response.text();

    if (response.status === 429 && attempt < maxAttempts) {
      const backoff = attempt * 2000;
      console.warn(`  Batch ${batchNum}: rate limited (429), retrying in ${backoff / 1000}s...`);
      await sleep(backoff);
      continue;
    }

    throw new Error(`Airtable upsert error on batch ${batchNum} (attempt ${attempt}): ${response.status} — ${err}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const SP_API_KEY = process.env.SECRET_PARTY_API_KEY;
const AT_API_KEY = process.env.AIRTABLE_API_KEY;

if (!SP_API_KEY || !AT_API_KEY) {
  console.error('Error: Missing SECRET_PARTY_API_KEY or AIRTABLE_API_KEY env vars');
  console.error('Run with: node --env-file=.dev.vars src/backfill-invitations.js');
  process.exit(1);
}

const targetTable = TABLES.invitations;
const baseId = BASES.invitations;

console.log('='.repeat(60));
console.log(`Target table : ${targetTable}`);
console.log(`Base ID      : ${baseId}`);
console.log(`Merge key    : ${MERGE_FIELD}`);
console.log(`Mode         : ${dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
console.log('='.repeat(60));

console.log('\nFetching all SP invitations...');
const spResponse = await fetch(`${SP_BASE_URL}/invitations`, {
  headers: { Authorization: `Bearer ${SP_API_KEY}` },
});
if (!spResponse.ok) throw new Error(`SP API error: ${spResponse.status} ${spResponse.statusText}`);
const spBody = await spResponse.json();
const spRecords = spBody.data ?? spBody.records ?? spBody.invitations ?? [];
console.log(`  ${spRecords.length} invitations from SP`);

if (spRecords.length === 0) {
  console.log('No SP records returned. Exiting.');
  process.exit(0);
}

const mapped = spRecords.map(mapRecord);

if (dryRun) {
  console.log(`\nDRY RUN — would upsert ${mapped.length} records. First 5 previewed below:`);
  mapped.slice(0, 5).forEach((r) => console.log(JSON.stringify(r, null, 2)));
  process.exit(0);
}

const batches = [];
for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
  batches.push(mapped.slice(i, i + BATCH_SIZE));
}

console.log(`\nUpserting ${mapped.length} records in ${batches.length} batches of ${BATCH_SIZE}...`);

let totalCreated = 0;
let totalUpdated = 0;

for (let i = 0; i < batches.length; i++) {
  const result = await upsertBatch(AT_API_KEY, baseId, targetTable, batches[i], i + 1, batches.length);
  totalCreated += result.created;
  totalUpdated += result.updated;
  if (i < batches.length - 1) await sleep(RATE_LIMIT_MS);
}

console.log('\n' + '='.repeat(60));
console.log(`Backfill complete.`);
console.log(`  Created : ${totalCreated}`);
console.log(`  Updated : ${totalUpdated}`);
console.log(`  Total   : ${totalCreated + totalUpdated}`);
