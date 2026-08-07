import { SYNC_STATE_FIELDS, BASES, TABLES } from './config.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';

// Transient Airtable failures. A single 502 killed the whole run on 2026-08-05,
// so one retry buys a lot of resilience for one extra subrequest.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAY_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Upsert one batch (max 10 records) into an Airtable table.
 *
 * Uses Airtable's native performUpsert keyed on `mergeField`, so re-running the
 * same batch is harmless — that idempotency is what lets the caller retry a
 * half-finished slice on the next invocation.
 *
 * @param {string} apiKey
 * @param {string} baseId
 * @param {string} tableId
 * @param {object[]} records - array of { fields: {...} }
 * @param {string} mergeField - Airtable field ID to match on
 * @param {import('./budget.js').Budget} budget
 * @returns {{ createdRecords: object[], updatedRecords: object[], requests: number }}
 */
export async function upsertBatch(apiKey, baseId, tableId, records, mergeField, budget) {
  let requests = 0;

  const send = async () => {
    budget.spend(1);
    requests++;
    return fetch(`${AIRTABLE_API}/${baseId}/${encodeURIComponent(tableId)}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        records,
        performUpsert: { fieldsToMergeOn: [mergeField] },
      }),
    });
  };

  let response = await send();

  // Only retry when there's budget to spare — never at the cost of the log write.
  if (!response.ok && RETRYABLE_STATUSES.has(response.status) && budget.canSpend(1)) {
    console.warn(`[airtable] ${tableId} returned ${response.status} — retrying once`);
    await sleep(RETRY_DELAY_MS);
    response = await send();
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Airtable upsert error (${tableId}): ${response.status} — ${body}`);
  }

  const data = await response.json();
  return {
    createdRecords: data.createdRecords ?? [],
    updatedRecords: data.updatedRecords ?? [],
    requests,
  };
}

/**
 * Read the cursor from the most recent sync log row for an endpoint.
 *
 * Returns null when no log row carries a cursor, which triggers a full sync.
 * Trimming {{Sync State}} therefore has teeth: delete every row for an endpoint
 * and the next run re-reads the entire dataset from scratch.
 *
 * @returns {string|null} cursor string (see src/cursor.js) or null
 */
export async function getCursor(apiKey, baseId, tableId, endpoint, budget) {
  const f = SYNC_STATE_FIELDS;
  const url = new URL(`${AIRTABLE_API}/${baseId}/${encodeURIComponent(tableId)}`);
  url.searchParams.set('filterByFormula', `AND({${f.endpoint}} = '${endpoint}', {${f.cursor}} != '')`);
  url.searchParams.set('sort[0][field]', f.syncedAt);
  url.searchParams.set('sort[0][direction]', 'desc');
  url.searchParams.set('maxRecords', '1');
  url.searchParams.set('returnFieldsByFieldId', 'true');

  budget.spend(1);
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`Airtable cursor read error: ${response.status}`);
  }

  const data = await response.json();
  return data.records?.[0]?.fields?.[f.cursor] ?? null;
}

/**
 * Read the most recent {{Sync State}} row for each endpoint. Backs GET /status.
 *
 * @returns {Record<string, { syncedAt, status, backlog, skipped, error, cursor }>}
 */
export async function getLatestRuns(apiKey) {
  const f = SYNC_STATE_FIELDS;
  const runs = {};

  for (const endpoint of ['invitations', 'tickets/add-ons']) {
    const url = new URL(`${AIRTABLE_API}/${BASES.syncState}/${encodeURIComponent(TABLES.syncState)}`);
    url.searchParams.set('filterByFormula', `{${f.endpoint}} = '${endpoint}'`);
    url.searchParams.set('sort[0][field]', f.syncedAt);
    url.searchParams.set('sort[0][direction]', 'desc');
    url.searchParams.set('maxRecords', '1');
    url.searchParams.set('returnFieldsByFieldId', 'true');

    const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!response.ok) throw new Error(`Airtable status read error: ${response.status}`);

    const fields = (await response.json()).records?.[0]?.fields ?? {};
    runs[endpoint] = {
      syncedAt: fields[f.syncedAt] ?? null,
      status: fields[f.status] ?? null,
      backlog: fields[f.backlogRemaining] ?? 0,
      skipped: fields[f.skippedOtherEvent] ?? 0,
      error: fields[f.error] ?? null,
      cursor: fields[f.cursor] ?? null,
    };
  }

  return runs;
}

/**
 * Append a run to {{Sync State}}.
 *
 * This is the only visibility the team has into whether the sync is alive, so it
 * must be affordable even on a run that otherwise exhausted its budget. Callers
 * reserve its subrequest up front and release it immediately before this call.
 *
 * @param {'success'|'partial'|'failed'} status
 * @param {object} result - { fetched, backlog, skipped, created, updated,
 *                            ticketsCreated, ticketsUpdated, addonsCreated, addonsUpdated }
 */
export async function logSync(apiKey, baseId, tableId, endpoint, triggeredBy, cursor, status, result, error = null, budget = null) {
  const f = SYNC_STATE_FIELDS;
  const fields = {
    [f.endpoint]:           endpoint,
    [f.triggeredBy]:        triggeredBy,
    [f.syncedAt]:           new Date().toISOString(),
    [f.status]:             status,
    [f.recordsFetched]:     result.fetched ?? 0,
    [f.backlogRemaining]:   result.backlog ?? 0,
    [f.skippedOtherEvent]:  result.skipped ?? 0,
    [f.invitationsCreated]: result.created ?? 0,
    [f.invitationsUpdated]: result.updated ?? 0,
    [f.ticketsCreated]:     result.ticketsCreated ?? 0,
    [f.ticketsUpdated]:     result.ticketsUpdated ?? 0,
    [f.addonsCreated]:      result.addonsCreated ?? 0,
    [f.addonsUpdated]:      result.addonsUpdated ?? 0,
  };
  if (cursor) fields[f.cursor] = cursor;
  if (error) fields[f.error] = error;

  if (budget) budget.spend(1);
  const response = await fetch(`${AIRTABLE_API}/${baseId}/${encodeURIComponent(tableId)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ records: [{ fields }] }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Airtable sync log error: ${response.status} — ${body}`);
  }
}
