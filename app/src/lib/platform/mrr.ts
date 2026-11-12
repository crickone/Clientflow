/**
 * MRR movements the way a finance person reads them: new, expansion,
 * contraction, churn, reactivation, net, per month. Pure: the caller turns
 * billing_events rows into MrrEvents. A month with no events is all zeros,
 * never missing, so a chart always has the same twelve columns.
 *
 * State-aware: every event is replayed in time order per business (events
 * before the window too, so the state is right when the window opens), and a
 * movement is only counted when it changes that business's paying state. So a
 * suspend then an offboard churns once, a reactivate of a business that never
 * stopped paying counts nothing, and an exempt business never moves MRR.
 */
export interface MrrEvent {
  tenantId: number;
  /** Epoch ms; the replay order. */
  at: number;
  /** Dublin YYYY-MM the event falls in. */
  month: string;
  type:
    | "activated"
    | "reactivated"
    | "suspended"
    | "offboarded"
    | "cancelled"
    | "price_changed"
    | "billing_exempted"
    | "billing_unexempted";
  /** The business's monthly price at the event, when it was recorded. */
  priceCents?: number;
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

export interface MrrAnalysis {
  movements: MrrMovement[];
  /** Businesses that stopped paying in each month (one per business per month). */
  churnedByMonth: Array<{ month: string; count: number }>;
}

/** Price for a business whose events carry none: e.g. its current effective price. */
export type StartingPrice = (tenantId: number) => number;

interface TenantState {
  paying: boolean;
  exempt: boolean;
  price: number | null;
}

export function mrrAnalysis(events: MrrEvent[], months: string[], startingPrice: StartingPrice = () => 0): MrrAnalysis {
  const by = new Map<string, MrrMovement>(
    months.map((m) => [m, { month: m, newCents: 0, expansionCents: 0, contractionCents: 0, churnCents: 0, reactivationCents: 0, netCents: 0 }]),
  );
  const churned = new Map<string, Set<number>>(months.map((m) => [m, new Set<number>()]));
  const states = new Map<number, TenantState>();

  const ordered = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.at - b.e.at || a.i - b.i);
  for (const { e } of ordered) {
    let s = states.get(e.tenantId);
    if (!s) { s = { paying: false, exempt: false, price: null }; states.set(e.tenantId, s); }
    const row = by.get(e.month);
    const priceAt = () => e.priceCents ?? s!.price ?? startingPrice(e.tenantId);

    switch (e.type) {
      case "activated":
      case "reactivated": {
        const price = priceAt();
        s.price = price;
        if (s.paying || s.exempt) break;
        s.paying = true;
        if (row) {
          if (e.type === "activated") row.newCents += price;
          else row.reactivationCents += price;
        }
        break;
      }
      case "suspended":
      case "offboarded":
      case "cancelled":
      case "billing_exempted": {
        if (e.type === "billing_exempted") s.exempt = true;
        if (!s.paying) break;
        s.paying = false;
        const price = s.price ?? priceAt();
        if (row) {
          row.churnCents += price;
          churned.get(e.month)!.add(e.tenantId);
        }
        break;
      }
      case "billing_unexempted":
        // No movement: they come back through activated/reactivated once they pay.
        s.exempt = false;
        break;
      case "price_changed": {
        const next = e.priceCents ?? s.price ?? startingPrice(e.tenantId);
        const prev = s.price ?? e.previousPriceCents ?? next;
        s.price = next;
        if (!s.paying || !row) break;
        const delta = next - prev;
        if (delta > 0) row.expansionCents += delta;
        else if (delta < 0) row.contractionCents += -delta;
        break;
      }
    }
  }

  for (const row of by.values()) {
    row.netCents = row.newCents + row.expansionCents + row.reactivationCents - row.contractionCents - row.churnCents;
  }
  return {
    movements: months.map((m) => by.get(m)!),
    churnedByMonth: months.map((m) => ({ month: m, count: churned.get(m)!.size })),
  };
}

export function mrrMovements(events: MrrEvent[], months: string[], startingPrice?: StartingPrice): MrrMovement[] {
  return mrrAnalysis(events, months, startingPrice).movements;
}
