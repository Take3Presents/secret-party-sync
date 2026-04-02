const AIRTABLE_API = 'https://api.airtable.com/v0';
const UPSERT_BATCH_SIZE = 10; // Airtable max per request

/**
 * Upsert records into an Airtable table.
 * Uses Airtable's native upsert (performUpsert) to guarantee no duplicates.
 *
 * @param {string} apiKey - Airtable personal access token
 * @param {string} baseId - e.g. 'appXXXXXXXXXXXXXX'
 * @param {string} tableId - table name or ID
 * @param {object[]} records - array of { fields: {...} } objects
 * @param {string} mergeField - the Airtable field name to match on (e.g. 'SP ID')
 * @returns {{ createdRecords: string[], updatedRecords: string[] }}
 */
export async function upsertRecords(apiKey, baseId, tableId, records, mergeField) {
  if (records.length === 0) return { createdRecords: [], updatedRecords: [] };

  const results = { createdRecords: [], updatedRecords: [] };

  // Airtable upsert only accepts 10 records per request — batch it
  for (let i = 0; i < records.length; i += UPSERT_BATCH_SIZE) {
    const batch = records.slice(i, i + UPSERT_BATCH_SIZE);

    const response = await fetch(`${AIRTABLE_API}/${baseId}/${encodeURIComponent(tableId)}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        records: batch,
        performUpsert: { fieldsToMergeOn: [mergeField] },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Airtable upsert error (${tableId}): ${response.status} — ${err}`);
    }

    const data = await response.json();
    results.createdRecords.push(...(data.createdRecords ?? []));
    results.updatedRecords.push(...(data.updatedRecords ?? []));
  }

  return results;
}

/**
 * Read the cursor from the most recent sync log row for a given endpoint.
 * Returns null if no log exists yet (triggers a full sync).
 *
 * @param {string} apiKey
 * @param {string} baseId
 * @param {string} tableId
 * @param {string} endpoint - 'invitations' or 'tickets'
 * @returns {string|null} ISO-8601 cursor or null
 */
export async function getCursor(apiKey, baseId, tableId, endpoint) {
  const url = new URL(`${AIRTABLE_API}/${baseId}/${encodeURIComponent(tableId)}`);
  url.searchParams.set('filterByFormula', `AND({Endpoint} = '${endpoint}', {Cursor} != '')`);
  url.searchParams.set('sort[0][field]', 'Synced At');
  url.searchParams.set('sort[0][direction]', 'desc');
  url.searchParams.set('maxRecords', '1');

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`Airtable cursor read error: ${response.status}`);
  }

  const data = await response.json();
  return data.records?.[0]?.fields?.['Cursor'] ?? null;
}

/**
 * Write a sync log row with all run details.
 *
 * @param {string} apiKey
 * @param {string} baseId
 * @param {string} tableId
 * @param {string} endpoint - 'invitations' or 'tickets'
 * @param {'scheduled'|'manual'} triggeredBy
 * @param {string|null} cursor - the next cursor value from SP
 * @param {'success'|'failed'} status
 * @param {{ created: number, updated: number, fetched: number }} result
 * @param {string|null} error - error message if failed
 */
export async function logSync(apiKey, baseId, tableId, endpoint, triggeredBy, cursor, status, result, error = null) {
  const isTickets = endpoint === 'tickets';
  const fields = {
    'Endpoint': endpoint,
    'Triggered By': triggeredBy,
    'Synced At': new Date().toISOString(),
    'Status': status,
    'Records Fetched': result.fetched,
    'Invitations Created': isTickets ? 0 : result.created,
    'Invitations Updated': isTickets ? 0 : result.updated,
    'Tickets Created': isTickets ? result.created : 0,
    'Tickets Updated': isTickets ? result.updated : 0,
  };
  if (cursor) fields['Cursor'] = cursor;
  if (error) fields['Error'] = error;

  const response = await fetch(`${AIRTABLE_API}/${baseId}/${encodeURIComponent(tableId)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ records: [{ fields }] }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Airtable sync log error: ${response.status} — ${err}`);
  }
}
