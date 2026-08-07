/**
 * Identify rows left over from a previous Secret Party event.
 *
 * "Stale" means the row carries an SP ID that the current API key no longer
 * returns — i.e. it belongs to an event this sync is no longer bound to. That is
 * a more reliable test than filtering on dates, which only correlate.
 *
 * Writes a CSV of the stale ticket rows so they can be reviewed before anyone
 * decides whether to delete them (they are linked to People and Email records).
 *
 * Usage:
 *   node --env-file=.dev.vars scripts/audit-stale.mjs            # report + CSV
 *   node --env-file=.dev.vars scripts/audit-stale.mjs --delete-invitations
 */

import { writeFileSync } from 'node:fs';
import { BASES, TABLES } from '../src/config.js';

const AIRTABLE_API = 'https://api.airtable.com/v0';
const SP_BASE_URL = 'https://api.secretparty.io/secret';
const AT = process.env.AIRTABLE_API_KEY;
const SP = process.env.SECRET_PARTY_API_KEY;

const deleteInvitations = process.argv.includes('--delete-invitations');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function spIds(endpoint) {
  const response = await fetch(`${SP_BASE_URL}/${endpoint}`, { headers: { Authorization: `Bearer ${SP}` } });
  if (!response.ok) throw new Error(`SP ${endpoint}: ${response.status}`);
  return new Set(((await response.json()).data ?? []).map((r) => r.id));
}

async function allRows(tableId) {
  let offset = null;
  const out = [];
  do {
    const url = new URL(`${AIRTABLE_API}/${BASES.tickets}/${encodeURIComponent(tableId)}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${AT}` } });
    if (!response.ok) throw new Error(`Airtable ${tableId}: ${response.status} — ${await response.text()}`);
    const data = await response.json();
    out.push(...data.records);
    offset = data.offset;
  } while (offset);
  return out;
}

async function deleteRows(tableId, ids) {
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const url = new URL(`${AIRTABLE_API}/${BASES.tickets}/${encodeURIComponent(tableId)}`);
    for (const id of chunk) url.searchParams.append('records[]', id);
    const response = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${AT}` } });
    if (!response.ok) throw new Error(`delete failed: ${response.status} — ${await response.text()}`);
    console.log(`  deleted ${chunk.length}`);
    await sleep(250);
  }
}

const csv = (rows) => rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');

// ── Invitations ──────────────────────────────────────────────────────────────

const liveInvitations = await spIds('invitations');
const invitationRows = await allRows(TABLES.invitations);
const staleInvitations = invitationRows.filter((r) => r.fields['SP ID'] && !liveInvitations.has(r.fields['SP ID']));

console.log(`Invitations: ${invitationRows.length} rows, ${liveInvitations.size} live in Secret Party`);
console.log(`  stale (SP ID no longer returned): ${staleInvitations.length}`);
for (const r of staleInvitations) {
  console.log(`    ${r.id}  SP ID ${r.fields['SP ID']}  ${r.fields['Invite Code'] ?? ''}  ${r.fields['Email'] ?? ''}  created ${r.fields['SP Created At'] ?? '?'}`);
}

// ── Tickets ──────────────────────────────────────────────────────────────────

const liveTickets = await spIds('tickets');
const ticketRows = await allRows(TABLES.tickets);
const staleTickets = ticketRows.filter((r) => r.fields['SP ID'] && !liveTickets.has(r.fields['SP ID']));

console.log(`\nTickets (${TABLES.tickets}): ${ticketRows.length} rows, ${liveTickets.size} live in Secret Party`);
console.log(`  stale (SP ID no longer returned): ${staleTickets.length}`);

const header = ['Airtable Record ID', 'SP ID', 'Ticket Code', 'SP Product Name', 'SP Status', 'SP Created At', 'Email from SP', 'First Name', 'Last Name', 'Linked People', 'Linked Email', 'Airtable Created'];
const body = staleTickets.map((r) => [
  r.id, r.fields['SP ID'], r.fields['Ticket Code'], r.fields['SP Product Name'], r.fields['SP Status'],
  r.fields['SP Created At'], r.fields['Email from SP'], r.fields['First Name'], r.fields['Last Name'],
  (r.fields['🫀People'] ?? []).join(' '), (r.fields['Email'] ?? []).join(' '), r.createdTime,
]);
const out = new URL('../tmp/stale-tickets.csv', import.meta.url);
writeFileSync(out, csv([header, ...body]));
console.log(`  wrote ${body.length} rows → ${out.pathname}`);

// ── Optional cleanup ─────────────────────────────────────────────────────────

if (deleteInvitations) {
  console.log(`\nDeleting ${staleInvitations.length} stale invitation row(s)...`);
  await deleteRows(TABLES.invitations, staleInvitations.map((r) => r.id));
  console.log('Done.');
} else {
  console.log('\nNo rows deleted. Re-run with --delete-invitations to remove the stale invitations.');
}
