/**
 * Tracks the Cloudflare subrequest budget for one Worker invocation.
 *
 * The free plan allows 50 outbound fetches per invocation and every Secret Party
 * or Airtable call spends one. Before this existed, a large sync window blew the
 * cap mid-run — including the call that writes the failure row to {{Sync State}},
 * which is why the August 2026 outage stayed invisible for three days.
 *
 * Reservations are the fix for that: the log write claims its subrequest up
 * front, so the upsert loop can never spend the budget needed to report itself.
 */
export class Budget {
  constructor(limit) {
    this.limit = limit;
    this.spent = 0;
    this.reserved = 0;
  }

  /** Claim `n` subrequests for later so the main loop can't consume them. */
  reserve(n) {
    this.reserved += n;
  }

  /** Hand a reservation back, immediately before spending it. */
  release(n) {
    this.reserved = Math.max(0, this.reserved - n);
  }

  /** Subrequests spendable right now without touching reservations. */
  get available() {
    return Math.max(0, this.limit - this.spent - this.reserved);
  }

  canSpend(n = 1) {
    return n <= this.available;
  }

  spend(n = 1) {
    if (!this.canSpend(n)) {
      throw new Error(
        `Subrequest budget exhausted (limit ${this.limit}, spent ${this.spent}, reserved ${this.reserved})`,
      );
    }
    this.spent += n;
  }

  toString() {
    return `${this.spent}/${this.limit} spent, ${this.reserved} reserved`;
  }
}
