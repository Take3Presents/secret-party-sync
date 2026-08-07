import { SP_BASE_URL } from './config.js';

/**
 * Fetch records from the Secret Party API.
 *
 * Secret Party returns every matching record in one response — there is no
 * pagination — so with no cursor this is the entire dataset for the event the
 * API key is scoped to. Rotating the key repoints this at a different event.
 *
 * `updated_after` is applied server-side but is inclusive and known to leak a few
 * older records through, so callers re-filter client-side (see src/cursor.js).
 *
 * @param {'invitations'|'tickets'} endpoint
 * @param {string} apiKey
 * @param {string|null} updatedAfter - ISO-8601 timestamp from the stored cursor
 * @param {import('./budget.js').Budget} budget
 * @returns {{ records: object[], meta: object }}
 */
export async function fetchRecords(endpoint, apiKey, updatedAfter = null, budget) {
  const url = new URL(`${SP_BASE_URL}/${endpoint}`);
  if (updatedAfter) url.searchParams.set('updated_after', updatedAfter);

  if (budget) budget.spend(1);
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`Secret Party API error: ${response.status} ${response.statusText} (${endpoint})`);
  }

  const body = await response.json();
  const records = body.data ?? body.records ?? body[endpoint] ?? [];

  return { records, meta: body.meta ?? {} };
}
