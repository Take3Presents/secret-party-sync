/**
 * Cursor helpers.
 *
 * A cursor is a keyset position in the stream of Secret Party records ordered by
 * (updated_at, id) — for example `2026-08-03T00:18:06.000Z|yV5Mq1e15j`.
 *
 * The id half is what makes partial progress safe. Secret Party bulk-loads
 * invitations, so ~10,000 records can share one `updated_at` value to the second.
 * A timestamp-only cursor cannot stop halfway through a tie: advancing past the
 * timestamp silently drops the rest of the tie, and not advancing means no
 * progress at all. Ordering by id as a tiebreak lets the sync stop anywhere and
 * resume exactly where it left off.
 *
 * Timestamp-only cursors written by older versions are still understood, and are
 * treated as strictly-after — the behaviour they had when they were written.
 */

const SEPARATOR = '|';

/** Split a stored cursor into its timestamp and id halves. */
export function parseCursor(raw) {
  if (!raw) return { ts: null, id: null };
  const i = raw.indexOf(SEPARATOR);
  if (i === -1) return { ts: raw, id: null };
  return { ts: raw.slice(0, i), id: raw.slice(i + 1) };
}

export function formatCursor(ts, id) {
  return `${ts}${SEPARATOR}${id}`;
}

/** The timestamp half — this is what Secret Party's `updated_after` param takes. */
export function cursorTimestamp(raw) {
  return parseCursor(raw).ts;
}

/** Order records the way the cursor walks them. */
export function compareRecords(a, b) {
  if (a.updated_at !== b.updated_at) return a.updated_at < b.updated_at ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

export function isAfterCursor(record, { ts, id }) {
  if (!ts) return true;
  if (record.updated_at !== ts) return record.updated_at > ts;
  // Same timestamp. A legacy cursor has no id to compare against, so treat the
  // whole tie as already consumed — exactly what the old filter did.
  return id === null ? false : record.id > id;
}

/**
 * The records still owed to us, in cursor order.
 *
 * Secret Party's `updated_after` is inclusive and has a known bug where a few
 * records come back regardless of the cursor, so this filter runs client-side on
 * every response rather than trusting the API to have applied it.
 */
export function windowAfter(records, cursor) {
  return records.filter((record) => isAfterCursor(record, cursor)).sort(compareRecords);
}
