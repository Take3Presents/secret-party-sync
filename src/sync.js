import { fetchRecords } from './secretparty.js';
import { upsertBatch, getCursor, logSync } from './airtable.js';
import { Budget } from './budget.js';
import { parseCursor, formatCursor, cursorTimestamp, windowAfter } from './cursor.js';
import {
  BASES, TABLES, MERGE_FIELDS, FIELD_MAP, COERCE_TO_STRING,
  SUBREQUEST_LIMIT, SUBREQUEST_SAFETY_MARGIN, UPSERT_BATCH_SIZE,
} from './config.js';

/**
 * Map a raw Secret Party record to Airtable fields using FIELD_MAP.
 *
 * null and undefined values are skipped rather than written, so a field Secret
 * Party doesn't know about won't clobber a value someone typed in by hand.
 *
 * @param {object} record - raw record from Secret Party
 * @param {'invitations'|'tickets'|'addons'} type
 * @returns {{ fields: object }}
 */
function mapRecord(record, type) {
  const map = FIELD_MAP[type];
  const fields = {};
  for (const [spField, airtableField] of Object.entries(map)) {
    // Support dot notation for nested fields (e.g. 'product.name')
    const value = spField.includes('.')
      ? spField.split('.').reduce((obj, key) => obj?.[key], record)
      : record[spField];
    if (value !== undefined && value !== null) {
      if (COERCE_TO_STRING.has(airtableField)) {
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

/**
 * Which Secret Party event a record belongs to.
 *
 * Invitations carry `event_id` at the top level; tickets and add-ons only carry
 * it on their nested invitation. Returns null when it genuinely can't be read —
 * callers must treat that as "unknown", never as "wrong event", or a shape change
 * upstream would silently drop every record.
 */
function eventIdOf(record) {
  return record.event_id ?? record.invitation?.event_id ?? null;
}

/**
 * Walk a cursor-ordered window, upserting each record into whichever table its
 * route picks, stopping cleanly the moment the budget or this endpoint's share
 * of it runs out.
 *
 * The cursor advances once per completed slice, so a window far larger than one
 * invocation can absorb gets chewed through across successive runs instead of
 * failing identically forever. Records the route rejects still let the cursor
 * move past them, so a window that is entirely someone else's event can't wedge.
 *
 * @returns {{ counts: object, processed: number, skipped: number, requests: number,
 *             last: object|null, error: Error|null, remaining: number }}
 */
async function processWindow({ airtableApiKey, records, route, budget, maxRequests }) {
  const counts = {};
  let processed = 0;
  let skipped = 0;
  let requests = 0;
  let last = null;
  let error = null;

  for (let i = 0; i < records.length; i += UPSERT_BATCH_SIZE) {
    const slice = records.slice(i, i + UPSERT_BATCH_SIZE);

    // Group by destination table. A slice normally hits one table; it only hits
    // two when tickets and add-ons interleave at this point in the stream.
    const groups = new Map();
    let sliceSkipped = 0;
    for (const record of slice) {
      const dest = route(record);
      if (!dest) {
        sliceSkipped++;
        continue;
      }
      if (!groups.has(dest.key)) groups.set(dest.key, { dest, items: [] });
      groups.get(dest.key).items.push(record);
    }

    if (requests + groups.size > maxRequests || !budget.canSpend(groups.size)) break;

    try {
      for (const { dest, items } of groups.values()) {
        const result = await upsertBatch(
          airtableApiKey,
          dest.baseId,
          dest.tableId,
          items.map((record) => mapRecord(record, dest.type)),
          dest.mergeField,
          budget,
        );
        requests += result.requests;
        const tally = (counts[dest.key] ??= { created: 0, updated: 0 });
        tally.created += result.createdRecords.length;
        tally.updated += result.updatedRecords.length;
      }
    } catch (err) {
      // Keep whatever the earlier slices achieved. The cursor stays on the last
      // fully-completed slice, so this one is simply retried next run.
      error = err;
      break;
    }

    processed += slice.length;
    skipped += sliceSkipped;
    last = slice[slice.length - 1];
  }

  return { counts, processed, skipped, requests, last, error, remaining: records.length - processed };
}

/**
 * Sync one Secret Party endpoint into Airtable and append a {{Sync State}} row.
 *
 * Never throws: a failure here is reported, not propagated, so one endpoint
 * going down can't take the other with it.
 *
 * @param {object} options
 * @param {string} options.label - {{Sync State}} endpoint value, also the cursor key
 * @param {string} options.spEndpoint - Secret Party path ('invitations' | 'tickets')
 * @param {(record: object) => object|null} options.route - destination, or null to skip
 * @param {(counts: object) => object} options.toLogFields - counts → {{Sync State}} numbers
 */
async function syncEndpoint({
  label, spEndpoint, route, toLogFields,
  spApiKey, airtableApiKey, triggeredBy, budget, maxUpsertRequests,
}) {
  let rawCursor = null;
  let nextCursor = null;
  let status = 'success';
  let errorMessage = null;
  let windowSize = 0;
  let outcome = { counts: {}, processed: 0, skipped: 0, remaining: 0, last: null, error: null };

  try {
    rawCursor = await getCursor(airtableApiKey, BASES.syncState, TABLES.syncState, label, budget);
    nextCursor = rawCursor;
    console.log(`[${label}] cursor: ${rawCursor ?? 'none — full sync'}`);

    const { records } = await fetchRecords(spEndpoint, spApiKey, cursorTimestamp(rawCursor), budget);
    const window = windowAfter(records, parseCursor(rawCursor));
    windowSize = window.length;
    console.log(`[${label}] window: ${windowSize} record(s) after cursor (Secret Party returned ${records.length})`);

    outcome = await processWindow({ airtableApiKey, records: window, route, budget, maxRequests: maxUpsertRequests });

    // The cursor only ever moves to a record we actually wrote. That invariant is
    // what makes stopping early safe — there is no way to step over unprocessed
    // records, and an empty window simply leaves the cursor where it is.
    if (outcome.last) nextCursor = formatCursor(outcome.last.updated_at, outcome.last.id);

    if (outcome.error) {
      status = outcome.processed > 0 ? 'partial' : 'failed';
      errorMessage = outcome.error.message;
      console.error(`[${label}] ${status}: ${errorMessage}`);
    } else if (outcome.remaining > 0) {
      status = 'partial';
      errorMessage = `Budget reached — ${outcome.remaining} record(s) still queued, continuing next run.`;
      console.log(`[${label}] ${errorMessage}`);
    }

    console.log(`[${label}] processed ${outcome.processed}, skipped ${outcome.skipped}, remaining ${outcome.remaining}, budget ${budget}`);
  } catch (err) {
    status = 'failed';
    errorMessage = err.message;
    console.error(`[${label}] failed: ${errorMessage}`);
  }

  try {
    budget.release(1); // reserved by runSync so this write is always affordable
    await logSync(
      airtableApiKey, BASES.syncState, TABLES.syncState, label, triggeredBy,
      nextCursor, status,
      {
        fetched: windowSize,
        backlog: outcome.remaining,
        skipped: outcome.skipped,
        ...toLogFields(outcome.counts),
      },
      errorMessage,
      budget,
    );
  } catch (err) {
    // Nothing left to report with. Surface it in the tail log and move on so the
    // other endpoint still gets its turn.
    console.error(`[${label}] could not write {{Sync State}} row: ${err.message}`);
  }

  return { status, windowSize, ...outcome };
}

/**
 * Run a full sync of all endpoints.
 *
 * @param {object} env - Worker environment (secrets + vars)
 * @param {'scheduled'|'manual'} triggeredBy
 */
export async function runSync(env, triggeredBy = 'scheduled') {
  const spApiKey = env.SECRET_PARTY_API_KEY;
  const airtableApiKey = env.AIRTABLE_API_KEY;
  const activeEventId = env.ACTIVE_EVENT_ID || null;

  console.log(`Sync started: ${new Date().toISOString()} (event ${activeEventId ?? 'filter disabled'})`);

  const budget = new Budget(SUBREQUEST_LIMIT - SUBREQUEST_SAFETY_MARGIN);
  budget.reserve(2); // one {{Sync State}} write per endpoint, never spendable elsewhere

  // Still to come after the reservations: two cursor reads and two Secret Party
  // fetches. Split what's left so a large invitation backlog can't starve ticket
  // sales — tickets go first and are capped at half, invitations get the rest
  // plus whatever tickets didn't need.
  const upsertPool = Math.max(0, budget.available - 4);
  const ticketShare = Math.floor(upsertPool / 2);

  /** Drop anything belonging to a different Secret Party event. */
  const belongsToActiveEvent = (record) => {
    if (!activeEventId) return true;
    const id = eventIdOf(record);
    return id === null || id === activeEventId; // unknown ≠ wrong
  };

  const ticketsResult = await syncEndpoint({
    label: 'tickets/add-ons',
    spEndpoint: 'tickets',
    route: (record) => {
      if (!belongsToActiveEvent(record)) return null;
      return record.product?.type === 'ticket'
        ? { key: 'tickets', baseId: BASES.tickets, tableId: TABLES.tickets, mergeField: MERGE_FIELDS.tickets, type: 'tickets' }
        : { key: 'addons', baseId: BASES.addons, tableId: TABLES.addons, mergeField: MERGE_FIELDS.addons, type: 'addons' };
    },
    toLogFields: (counts) => ({
      ticketsCreated: counts.tickets?.created ?? 0,
      ticketsUpdated: counts.tickets?.updated ?? 0,
      addonsCreated: counts.addons?.created ?? 0,
      addonsUpdated: counts.addons?.updated ?? 0,
    }),
    spApiKey, airtableApiKey, triggeredBy, budget,
    maxUpsertRequests: ticketShare,
  });

  const invitationsResult = await syncEndpoint({
    label: 'invitations',
    spEndpoint: 'invitations',
    route: (record) => (belongsToActiveEvent(record)
      ? { key: 'invitations', baseId: BASES.invitations, tableId: TABLES.invitations, mergeField: MERGE_FIELDS.invitations, type: 'invitations' }
      : null),
    toLogFields: (counts) => ({
      created: counts.invitations?.created ?? 0,
      updated: counts.invitations?.updated ?? 0,
    }),
    spApiKey, airtableApiKey, triggeredBy, budget,
    maxUpsertRequests: Infinity, // the budget itself is the only remaining limit
  });

  const summary = {
    invitations: {
      status: invitationsResult.status,
      fetched: invitationsResult.windowSize,
      processed: invitationsResult.processed,
      backlog: invitationsResult.remaining,
      created: invitationsResult.counts.invitations?.created ?? 0,
      updated: invitationsResult.counts.invitations?.updated ?? 0,
    },
    tickets: {
      status: ticketsResult.status,
      fetched: ticketsResult.windowSize,
      processed: ticketsResult.processed,
      backlog: ticketsResult.remaining,
      ticketsCreated: ticketsResult.counts.tickets?.created ?? 0,
      ticketsUpdated: ticketsResult.counts.tickets?.updated ?? 0,
      addonsCreated: ticketsResult.counts.addons?.created ?? 0,
      addonsUpdated: ticketsResult.counts.addons?.updated ?? 0,
    },
    subrequests: { spent: budget.spent, limit: budget.limit },
    timestamp: new Date().toISOString(),
  };

  console.log('Sync complete:', JSON.stringify(summary));
  return summary;
}
