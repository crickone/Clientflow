import type { MoneyView } from "./metrics/breakdown";
import type { WidgetCtx } from "./types";

/** Link from a money tile to the rows behind it, over the tile's own range. */
export function moneyHref(view: MoneyView): (ctx: WidgetCtx) => string {
  return (ctx) => {
    const r = ctx.range;
    const q = r.key === "custom" ? `range=custom&from=${r.fromIso}&to=${r.toIso}` : `range=${r.key}`;
    return `/dashboard/money/${view}?${q}`;
  };
}
