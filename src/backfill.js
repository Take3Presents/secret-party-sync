/**
 * One-time backfill script: find existing Airtable records that have an SP ID
 * (or can be matched via code) and patch in ALL SP fields.
 *
 * Run with:
 *   SECRET_PARTY_API_KEY=... AIRTABLE_API_KEY=... node src/backfill.js
 */

import { BASES, TABLES, SP_BASE_URL, FIELD_MAP } from './config.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';

// ── Secret Party helpers ──────────────────────────────────────────────────────

async function fetchAllSP(endpoint, apiKey) {
  const url = new URL(`${SP_BASE_URL}/${endpoint}`);
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`SP API error: ${response.status} (${endpoint})`);
  const body = await response.json();
  return body.data ?? body.records ?? body[endpoint] ?? [];
}

// ── Airtable helpers ──────────────────────────────────────────────────────────

async function fetchAllAirtableRecords(apiKey, baseId, tableId) {
  const records = [];
  let offset = null;

  do {
    const url = new URL(`${AIRTABLE_API}/${baseId}/${encodeURIComponent(tableId)}`);
    url.searchParams.set('fields[]', 'SP ID');
    url.searchParams.set('fields[]', 'Invitation Code');
    url.searchParams.set('fields[]', 'Ticket Code');
    if (offset) url.searchParams.set('offset', offset);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) throw new Error(`Airtable list error: ${response.status}`);

    const data = await response.json();
    records.push(...(data.records ?? []));
    offset = data.offset ?? null;
  } while (offset);

  return records;
}

async function patchRecords(apiKey, baseId, tableId, updates) {
  const BATCH = 10;
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    const response = await fetch(`${AIRTABLE_API}/${baseId}/${encodeURIComponent(tableId)}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ records: batch }),
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Airtable patch error: ${response.status} — ${err}`);
    }
  }
}

// Map all SP fields onto an Airtable fields object using FIELD_MAP
function mapSpRecord(spRecord, type) {
  const map = FIELD_MAP[type];
  const fields = {};
  for (const [spField, airtableField] of Object.entries(map)) {
    const value = spField.includes('.')
      ? spField.split('.').reduce((obj, key) => obj?.[key], spRecord)
      : spRecord[spField];
    if (value !== undefined && value !== null) {
      fields[airtableField] = value;
    }
  }
  return fields;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const SP_API_KEY = process.env.SECRET_PARTY_API_KEY;
const AT_API_KEY = process.env.AIRTABLE_API_KEY;

if (!SP_API_KEY || !AT_API_KEY) {
  console.error('Missing SECRET_PARTY_API_KEY or AIRTABLE_API_KEY env vars');
  process.exit(1);
}

console.log('Fetching SP tickets...');
const spTickets = await fetchAllSP('tickets', SP_API_KEY);

// Build lookup maps: code → full SP record, id → full SP record
const ticketByCode = new Map(spTickets.map((r) => [r.code, r]));
const ticketById = new Map(spTickets.map((r) => [String(r.id), r]));

console.log(`  SP tickets: ${spTickets.length}`);

console.log('\nFetching all Airtable records...');
const baseId = BASES.tickets;
const tableId = TABLES.tickets;
const airtableRecords = await fetchAllAirtableRecords(AT_API_KEY, baseId, tableId);
console.log(`  Found ${airtableRecords.length} Airtable records`);

const updates = [];
let matched = 0;
let unmatched = 0;

for (const record of airtableRecords) {
  const spId = record.fields['SP ID'];
  const ticketCode = record.fields['Ticket Code'];

  // Match by SP ID first, then fall back to ticket code
  let spRecord = null;
  if (spId && ticketById.has(spId)) {
    spRecord = ticketById.get(spId);
  } else if (ticketCode && ticketByCode.has(ticketCode)) {
    spRecord = ticketByCode.get(ticketCode);
  }

  if (spRecord) {
    const fields = mapSpRecord(spRecord, 'tickets');
    updates.push({ id: record.id, fields });
    matched++;
  } else {
    console.log(`  No match for record ${record.id} (SP ID: ${spId ?? '—'}, ticket: ${ticketCode ?? '—'})`);
    unmatched++;
  }
}

console.log(`\nMatched: ${matched}, Unmatched: ${unmatched}`);

if (updates.length > 0) {
  console.log(`Patching ${updates.length} records with all SP fields...`);
  await patchRecords(AT_API_KEY, baseId, tableId, updates);
  console.log('Done.');
} else {
  console.log('Nothing to patch.');
}
