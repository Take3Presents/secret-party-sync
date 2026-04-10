import { fetchRecords } from './secretparty.js';
import { upsertRecords, getCursor, logSync } from './airtable.js';
import { BASES, TABLES, MERGE_FIELDS, FIELD_MAP, COERCE_TO_STRING } from './config.js';

/**
 * Map a raw Secret Party record to Airtable fields using FIELD_MAP.
 * Only includes fields that are defined in the map.
 *
 * @param {object} record - raw record from Secret Party API
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
 * Sync invitations endpoint.
 *
 * @param {string} spApiKey
 * @param {string} airtableApiKey
 * @param {string} triggeredBy
 * @returns {{ created: number, updated: number, fetched: number }}
 */
async function syncInvitations(spApiKey, airtableApiKey, triggeredBy) {
  const cursor = await getCursor(airtableApiKey, BASES.syncState, TABLES.syncState, 'invitations');
  console.log(`[invitations] cursor: ${cursor ?? 'none — full sync'}`);

  let nextCursor = cursor;
  let fetched = 0;
  let created = 0;
  let updated = 0;

  try {
    const { records, meta } = await fetchRecords('invitations', spApiKey, cursor);
    fetched = meta.returned_count;

    nextCursor = meta.next_updated_after ?? cursor;
    if (nextCursor && cursor && nextCursor === cursor) {
      nextCursor = new Date(new Date(cursor).getTime() + 1000).toISOString();
      console.log(`[invitations] cursor unchanged — nudging forward to: ${nextCursor}`);
    }

    const genuineRecords = cursor ? records.filter((r) => r.updated_at > cursor) : records;
    fetched = genuineRecords.length;
    console.log(`[invitations] genuine records after cursor filter: ${fetched} (SP returned ${records.length})`);

    if (genuineRecords.length > 0) {
      const airtableRecords = genuineRecords.map((r) => mapRecord(r, 'invitations'));
      const result = await upsertRecords(airtableApiKey, BASES.invitations, TABLES.invitations, airtableRecords, MERGE_FIELDS.invitations);
      created = result.createdRecords.length;
      updated = result.updatedRecords.length;
      console.log(`[invitations] created: ${created}, updated: ${updated}`);
    }

    await logSync(airtableApiKey, BASES.syncState, TABLES.syncState, 'invitations', triggeredBy, nextCursor, 'success', { created, updated, fetched });
  } catch (err) {
    console.error(`[invitations] error: ${err.message}`);
    await logSync(airtableApiKey, BASES.syncState, TABLES.syncState, 'invitations', triggeredBy, cursor, 'failed', { created, updated, fetched }, err.message);
    throw err;
  }

  return { fetched, created, updated };
}

/**
 * Sync tickets and add-ons from a single SP fetch, upsert to their respective tables,
 * and log as a single 'tickets/add-ons' row.
 *
 * @param {string} spApiKey
 * @param {string} airtableApiKey
 * @param {string} triggeredBy
 * @returns {{ fetched: number, ticketsCreated: number, ticketsUpdated: number, addonsCreated: number, addonsUpdated: number }}
 */
async function syncTicketsAndAddons(spApiKey, airtableApiKey, triggeredBy) {
  const cursor = await getCursor(airtableApiKey, BASES.syncState, TABLES.syncState, 'tickets/add-ons');
  console.log(`[tickets/add-ons] cursor: ${cursor ?? 'none — full sync'}`);

  let nextCursor = cursor;
  let fetched = 0;
  let ticketsCreated = 0;
  let ticketsUpdated = 0;
  let addonsCreated = 0;
  let addonsUpdated = 0;

  try {
    const { records, meta } = await fetchRecords('tickets', spApiKey, cursor);

    nextCursor = meta.next_updated_after ?? cursor;
    if (nextCursor && cursor && nextCursor === cursor) {
      nextCursor = new Date(new Date(cursor).getTime() + 1000).toISOString();
      console.log(`[tickets/add-ons] cursor unchanged — nudging forward to: ${nextCursor}`);
    }

    // Filter out stale records (known SP API bug: some records always returned regardless of cursor)
    const genuineRecords = cursor ? records.filter((r) => r.updated_at > cursor) : records;

    // Split into tickets and add-ons
    const tickets = genuineRecords.filter((r) => r.product?.type === 'ticket');
    const addons = genuineRecords.filter((r) => r.product?.type !== 'ticket');
    fetched = genuineRecords.length;
    console.log(`[tickets/add-ons] genuine: ${fetched} total (${tickets.length} tickets, ${addons.length} add-ons) — SP returned ${records.length}`);

    // Upsert tickets
    if (tickets.length > 0) {
      const result = await upsertRecords(
        airtableApiKey, BASES.tickets, TABLES.tickets,
        tickets.map((r) => mapRecord(r, 'tickets')),
        MERGE_FIELDS.tickets,
      );
      ticketsCreated = result.createdRecords.length;
      ticketsUpdated = result.updatedRecords.length;
      console.log(`[tickets] created: ${ticketsCreated}, updated: ${ticketsUpdated}`);
    }

    // Upsert add-ons
    if (addons.length > 0) {
      const result = await upsertRecords(
        airtableApiKey, BASES.addons, TABLES.addons,
        addons.map((r) => mapRecord(r, 'addons')),
        MERGE_FIELDS.addons,
      );
      addonsCreated = result.createdRecords.length;
      addonsUpdated = result.updatedRecords.length;
      console.log(`[add-ons] created: ${addonsCreated}, updated: ${addonsUpdated}`);
    }

    await logSync(airtableApiKey, BASES.syncState, TABLES.syncState, 'tickets/add-ons', triggeredBy, nextCursor, 'success', { fetched, ticketsCreated, ticketsUpdated, addonsCreated, addonsUpdated });
  } catch (err) {
    console.error(`[tickets/add-ons] error: ${err.message}`);
    await logSync(airtableApiKey, BASES.syncState, TABLES.syncState, 'tickets/add-ons', triggeredBy, cursor, 'failed', { fetched, ticketsCreated, ticketsUpdated, addonsCreated, addonsUpdated }, err.message);
    throw err;
  }

  return { fetched, ticketsCreated, ticketsUpdated, addonsCreated, addonsUpdated };
}

/**
 * Run a full sync of all endpoints.
 *
 * @param {string} spApiKey
 * @param {string} airtableApiKey
 * @param {'scheduled'|'manual'} triggeredBy
 * @returns {object} summary of what happened
 */
export async function runSync(spApiKey, airtableApiKey, triggeredBy = 'scheduled') {
  console.log('Sync started:', new Date().toISOString());

  const invitationResult = await syncInvitations(spApiKey, airtableApiKey, triggeredBy);
  const ticketsResult = await syncTicketsAndAddons(spApiKey, airtableApiKey, triggeredBy);

  const summary = {
    invitations: invitationResult,
    tickets: ticketsResult,
    timestamp: new Date().toISOString(),
  };

  console.log('Sync complete:', JSON.stringify(summary));
  return summary;
}
