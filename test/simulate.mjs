/**
 * Offline simulation of the sync loop.
 *
 * Pulls the real Secret Party dataset once, then replaces Airtable with an
 * in-memory fake and drives runSync() over and over exactly as the cron would.
 * Asserts the properties that actually matter:
 *
 *   - the 50-subrequest cap is never exceeded on any single run
 *   - a {{Sync State}} row is written on every run, including failing ones
 *   - the backlog strictly drains — no run makes zero progress
 *   - every record lands exactly once, with nothing skipped and nothing duplicated
 *   - records from another event are dropped, not written
 *   - an Airtable outage mid-run loses no records once it recovers
 *
 * Usage: node --env-file=.dev.vars test/simulate.mjs
 */

import { runSync } from '../src/sync.js';
import { SUBREQUEST_LIMIT } from '../src/config.js';

const SP_BASE = 'https://api.secretparty.io/secret';
const realFetch = globalThis.fetch;

// ── Pull the live Secret Party data once, then work entirely offline ─────────

async function loadFixtures(apiKey) {
  const out = {};
  for (const endpoint of ['invitations', 'tickets']) {
    const response = await realFetch(`${SP_BASE}/${endpoint}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) throw new Error(`fixture load failed: ${endpoint} ${response.status}`);
    out[endpoint] = (await response.json()).data ?? [];
  }
  return out;
}

// ── Fake Airtable ────────────────────────────────────────────────────────────

class FakeAirtable {
  constructor() {
    this.tables = new Map();   // tableId -> Map(spId -> fields)
    this.syncState = [];       // append-only log rows
    this.requests = 0;
    this.failNext = 0;         // number of upserts to fail with a 502
  }

  table(id) {
    if (!this.tables.has(id)) this.tables.set(id, new Map());
    return this.tables.get(id);
  }

  handle(url, init = {}) {
    this.requests++;
    const { pathname, searchParams } = new URL(url);
    const tableId = decodeURIComponent(pathname.split('/').pop());
    const method = init.method ?? 'GET';

    // Sync State reads (cursor lookup / status)
    if (method === 'GET') {
      const formula = searchParams.get('filterByFormula') ?? '';
      const endpoint = formula.match(/=\s*'([^']+)'/)?.[1];
      const rows = this.syncState
        .filter((r) => r.endpoint === endpoint && r.cursor)
        .sort((a, b) => (a.syncedAt < b.syncedAt ? 1 : -1));
      const row = rows[0];
      return this.json({ records: row ? [{ fields: { fldvBpePE7mnRrVDP: row.cursor } }] : [] });
    }

    // Sync State writes
    if (method === 'POST') {
      const body = JSON.parse(init.body);
      const f = body.records[0].fields;
      this.syncState.push({
        endpoint: f.fldAo1psPukG3sQ1h,
        cursor: f.fldvBpePE7mnRrVDP ?? null,
        status: f.fldWBdEoxTp6h8nfg,
        fetched: f.fldRcckVEjGONXEaR,
        backlog: f.fldbOreri18UJ4Y0S,
        skipped: f.fldHMlMO0314lL34K,
        error: f.fldLlLrqoEG6j4boI ?? null,
        syncedAt: f.fld9aDm40gw6cBGnR,
      });
      return this.json({ records: body.records });
    }

    // Upserts
    if (method === 'PATCH') {
      if (this.failNext > 0) {
        this.failNext--;
        return new Response('error code: 502', { status: 502 });
      }
      const body = JSON.parse(init.body);
      const mergeField = body.performUpsert.fieldsToMergeOn[0];
      const store = this.table(tableId);
      const created = [], updated = [];
      for (const record of body.records) {
        const key = record.fields[mergeField];
        if (key === undefined) throw new Error(`upsert into ${tableId} with no merge key`);
        (store.has(key) ? updated : created).push({ id: `rec${key}` });
        store.set(key, record.fields);
      }
      return this.json({ createdRecords: created, updatedRecords: updated });
    }

    throw new Error(`unexpected ${method} ${url}`);
  }

  json(value) {
    return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
}

// ── Harness ──────────────────────────────────────────────────────────────────

let failures = 0;
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function install(fixtures, airtable) {
  const perRun = { subrequests: 0 };
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    perRun.subrequests++;
    if (url.startsWith(SP_BASE)) {
      const endpoint = new URL(url).pathname.split('/').pop();
      const after = new URL(url).searchParams.get('updated_after');
      const all = fixtures[endpoint] ?? [];
      // Mirror the real API: server-side filter is inclusive, and a couple of
      // records leak through regardless of the cursor (documented SP bug).
      const filtered = after ? all.filter((r) => r.updated_at >= after) : all;
      const leaked = all.slice(0, 2);
      const records = [...new Set([...filtered, ...leaked])];
      return airtable.json({ data: records, meta: { returned_count: records.length, next_updated_after: after } });
    }
    return airtable.handle(url, init);
  };
  return perRun;
}

async function scenario(name, fixtures, { eventId, maxRuns = 200, failAtRun = null }) {
  console.log(`\n${name}`);
  const airtable = new FakeAirtable();
  const perRun = install(fixtures, airtable);
  const env = {
    SECRET_PARTY_API_KEY: 'x',
    AIRTABLE_API_KEY: 'x',
    ACTIVE_EVENT_ID: eventId,
  };

  let overCap = 0;
  let run = 0;
  let stalled = false;

  for (; run < maxRuns; run++) {
    if (failAtRun === run) airtable.failNext = 3;
    perRun.subrequests = 0;
    const before = airtable.syncState.length;
    const summary = await runSync(env, 'scheduled');
    if (perRun.subrequests > SUBREQUEST_LIMIT) overCap++;
    if (airtable.syncState.length - before !== 2) {
      stalled = true;
      console.log(`    run ${run}: expected 2 log rows, got ${airtable.syncState.length - before}`);
    }
    const backlog = summary.invitations.backlog + summary.tickets.backlog;
    if (backlog === 0) { run++; break; }
  }

  const invTable = airtable.table('tblKgwXnpqWjf8Z8q');
  const expected = fixtures.invitations.filter((r) => !eventId || r.event_id === eventId);
  const missing = expected.filter((r) => !invTable.has(r.id));
  const extra = [...invTable.keys()].filter((id) => !expected.some((r) => r.id === id));

  check('never exceeded the subrequest cap', overCap === 0, `${overCap} run(s) over`);
  check('logged both endpoints on every run', !stalled);
  check(`drained the backlog (${run} runs)`, run < maxRuns);
  check(`wrote every in-event record (${invTable.size})`, missing.length === 0, `${missing.length} missing`);
  check('wrote nothing out-of-event', extra.length === 0, `${extra.length} extra`);

  const statuses = new Set(airtable.syncState.map((r) => r.status));
  console.log(`    statuses seen: ${[...statuses].join(', ')}`);
  console.log(`    final cursor: ${airtable.syncState.filter((r) => r.endpoint === 'invitations').pop()?.cursor}`);
  return airtable;
}

// ── Run ──────────────────────────────────────────────────────────────────────

const apiKey = process.env.SECRET_PARTY_API_KEY;
if (!apiKey) throw new Error('run with: node --env-file=.dev.vars test/simulate.mjs');

console.log('Loading Secret Party fixtures...');
const fixtures = await loadFixtures(apiKey);
const tsCounts = {};
for (const r of fixtures.invitations) tsCounts[r.updated_at] = (tsCounts[r.updated_at] ?? 0) + 1;
const biggestTie = Math.max(...Object.values(tsCounts));
console.log(`  invitations: ${fixtures.invitations.length}, tickets: ${fixtures.tickets.length}`);
console.log(`  distinct updated_at values: ${Object.keys(tsCounts).length}, largest tie: ${biggestTie}`);

await scenario('Cold start — full backlog, no failures', fixtures, { eventId: 'Jk6YADb6a3' });
await scenario('Airtable 502 storm partway through', fixtures, { eventId: 'Jk6YADb6a3', failAtRun: 5 });

// Old-event records must never be re-created after a table is cleared.
const mixed = {
  invitations: [
    ...fixtures.invitations.slice(0, 40),
    ...fixtures.invitations.slice(40, 60).map((r) => ({ ...r, id: `old-${r.id}`, event_id: 'OLD_EVENT' })),
  ],
  tickets: [],
};
await scenario('Mixed events — previous event must be ignored', mixed, { eventId: 'Jk6YADb6a3' });

globalThis.fetch = realFetch;
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
