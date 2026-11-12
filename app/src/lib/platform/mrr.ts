/**
 * MRR movements the way a finance person reads them: new, expansion,
 * contraction, churn, reactivation, net, per month. Pure: the caller turns
 * billing_events rows into MrrEvents. A month with no events is all zeros,
 * never missing, so a chart always has the same twelve columns.
 */
export interface MrrEvent {
  tenantId: number;
  month: string;
  type: "activated" | "reactivated" | "suspended" | "offboarded" | "cancelled" | "price_changed";
  priceCents: number;
  previousPriceCents?: number;
}

export interface MrrMovement {
  month: string;
  newCents: number;
  expansionCents: number;
  contractionCents: number;
  churnCents: number;
  reactivationCents: number;
  netCents: number;
}

export function mrrMovements(events: MrrEvent[], months: string[]): MrrMovement[] {
  const by = new Map(months.map((m) => [m, { month: m, newCents: 0, expansionCents: 0, contractionCents: 0, churnCents: 0, reactivationCents: 0, netCents: 0 }]));
  for (const e of events) {
    const row = by.get(e.month);
    if (!row) continue;
    switch (e.type) {
      case "activated": row.newCents += e.priceCents; break;
      case "reactivated": row.reactivationCents += e.priceCents; break;
      case "suspended":
      case "offboarded":
      case "cancelled": row.churnCents += e.priceCents; break;
      case "price_changed": {
        const delta = e.priceCents - (e.previousPriceCents ?? e.priceCents);
        if (delta > 0) row.expansionCents += delta;
        else row.contractionCents += -delta;
        break;
      }
    }
  }
  for (const row of by.values()) row.netCents = row.newCents + row.expansionCents + row.reactivationCents - row.contractionCents - row.churnCents;
  return months.map((m) => by.get(m)!);
}
