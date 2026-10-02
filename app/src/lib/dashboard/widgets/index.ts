import "server-only";

import type { WidgetKey } from "../catalog";
import type { WidgetImpl } from "../types";
import { OVERVIEW_WIDGETS } from "./overview";
import { SALES_WIDGETS } from "./sales";

export { cached } from "./cache";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const WIDGET_IMPLS = {
  ...OVERVIEW_WIDGETS,
  ...SALES_WIDGETS,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<WidgetKey, WidgetImpl<any>>;
