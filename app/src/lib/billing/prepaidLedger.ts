import "server-only";

import { controlSqlite } from "@/lib/db/control";

/**
 * The prepaid-credit balance mechanism, in ONE place.
 *
 * Three products now sell prepaid credits — email sends (@/lib/email/credits),
 * AI usage (@/lib/ai/creditsLedger) and voice minutes (@/lib/voice/credits) —
 * and the first two were near-identical hand-rolled copies of the same
 * money-safety invariant. This module is that invariant, extracted at the
 * third instance rather than cloned a third time:
 *
 *   every balance change is ONE controlSqlite.transaction() that reads the
 *   current balance, computes the new one, guards it, writes it, and inserts
 *   exactly one ledger row carrying that same balance_after_cents
 *
 * SQLite serialises writers (busy_timeout, see db/control.ts), so two
 * concurrent spends can't interleave their read-compute-write; a throw
 * anywhere inside rolls the whole thing back, leaving no partial write and no
 * orphan ledger row.
 *
 * What each product keeps for itself: its own public API (unchanged — every
 * existing call site and test still calls grantCredits/recordCreditSpend/
 * grantAiCredits/… exactly as before), its own error type, its own
 * pricing/tranche rules, its own auto-topup + suspension columns. Only the
 * balance+ledger write is shared, because that is the only part where a
 * divergence between the three would be a MONEY bug rather than a product
 * difference.
 *
 * The two axes on which the three legitimately differ, both parameters here:
 *   - `allowNegative` — email/voice know a spend's cost BEFORE doing the work
 *     and refuse up front, so their balance must never go below zero; AI only
 *     learns the cost after the tokens are burned, so its last call is allowed
 *     to overshoot into a small debt that blocks the next one.
 *   - `ledgerExtras`  — email's ledger carries a campaign_id; the others have
 *     no such foreign context.
 */

/** Identifier guard: table/column names are interpolated into SQL below. They're module-level literals at every call site, never user input — this just makes that structural fact enforced rather than assumed. */
const IDENT = /^[a-z_][a-z0-9_]*$/;
function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return name;
}

export interface PrepaidLedgerSpec {
  /** Sparse one-row-per-tenant balance table, e.g. "email_credits". Must have `tenant_id` PK, `balance_cents`, `updated_at`. */
  balanceTable: string;
  /** Append-only audit table, e.g. "email_credit_ledger". Must have tenant_id, delta_cents, reason, balance_after_cents, note. */
  ledgerTable: string;
  /** Extra ledger columns, in order, filled from `mutate`'s `extras`. e.g. ["campaign_id"]. */
  ledgerExtras?: readonly string[];
  /** When true, a spend may drive the balance below zero (AI only — see the file header). */
  allowNegative?: boolean;
  /** Builds the product's own error type for a refused spend, so callers keep catching what they always caught. */
  insufficient: (balanceCents: number, wouldBeCents: number) => Error;
}

export interface PrepaidLedger {
  /** Current balance (cents). Sparse: a tenant with no row reads as 0. */
  getBalanceCents(tenantId: number): number;
  /**
   * The ONE place this product's balance_cents is ever written. Returns the
   * new balance. Throws the spec's `insufficient` error (writing nothing) if
   * the change would go negative and `allowNegative` is off.
   */
  mutate(
    tenantId: number,
    deltaCents: number,
    reason: string,
    opts?: { note?: string | null; extras?: readonly unknown[] },
  ): number;
}

export function createPrepaidLedger(spec: PrepaidLedgerSpec): PrepaidLedger {
  const balanceTable = ident(spec.balanceTable);
  const ledgerTable = ident(spec.ledgerTable);
  const extras = (spec.ledgerExtras ?? []).map(ident);

  const selectSql = `SELECT balance_cents FROM ${balanceTable} WHERE tenant_id = ?`;
  const upsertSql = `INSERT INTO ${balanceTable} (tenant_id, balance_cents, updated_at)
     VALUES (?, ?, unixepoch() * 1000)
     ON CONFLICT(tenant_id) DO UPDATE SET
       balance_cents = excluded.balance_cents,
       updated_at = excluded.updated_at`;
  const ledgerCols = ["tenant_id", "delta_cents", "reason", ...extras, "balance_after_cents", "note"];
  const insertLedgerSql = `INSERT INTO ${ledgerTable} (${ledgerCols.join(", ")})
     VALUES (${ledgerCols.map(() => "?").join(", ")})`;

  function getBalanceCents(tenantId: number): number {
    const row = controlSqlite.prepare(selectSql).get(tenantId) as
      | { balance_cents: number }
      | undefined;
    return row?.balance_cents ?? 0;
  }

  function mutate(
    tenantId: number,
    deltaCents: number,
    reason: string,
    opts: { note?: string | null; extras?: readonly unknown[] } = {},
  ): number {
    const extraValues = opts.extras ?? extras.map(() => null);
    if (extraValues.length !== extras.length) {
      throw new Error(
        `${ledgerTable}: expected ${extras.length} extra ledger value(s), got ${extraValues.length}.`,
      );
    }
    const run = controlSqlite.transaction(() => {
      const currentBalance = getBalanceCents(tenantId);
      const newBalance = currentBalance + deltaCents;
      if (newBalance < 0 && !spec.allowNegative) {
        throw spec.insufficient(currentBalance, newBalance);
      }
      controlSqlite.prepare(upsertSql).run(tenantId, newBalance);
      controlSqlite
        .prepare(insertLedgerSql)
        .run(tenantId, deltaCents, reason, ...extraValues, newBalance, opts.note ?? null);
      return newBalance;
    });
    return run();
  }

  return { getBalanceCents, mutate };
}
