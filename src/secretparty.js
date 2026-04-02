import { SP_BASE_URL } from './config.js';

/**
 * Fetch a page of records from the Secret Party API.
 * @param {string} endpoint - 'invitations' or 'tickets'
 * @param {string} apiKey
 * @param {string|null} updatedAfter - ISO-8601 cursor from previous sync
 * @returns {{ records: object[], meta: { returned_count: number, next_updated_after: string } }}
 */
export async function fetchRecords(endpoint, apiKey, updatedAfter = null) {
  const url = new URL(`${SP_BASE_URL}/${endpoint}`);
  if (updatedAfter) url.searchParams.set('updated_after', updatedAfter);

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`Secret Party API error: ${response.status} ${response.statusText} (${endpoint})`);
  }

  const body = await response.json();

  // The API doc shows meta.returned_count and meta.next_updated_after.
  // Records are expected to be the top-level array — adjust the key below
  // if the actual response wraps them differently (e.g. body.data or body.records).
  const records = body.data ?? body.records ?? body[endpoint] ?? [];

  return {
    records,
    meta: body.meta,
  };
}
