import "server-only";

import type { WidgetKey } from "../catalog";
import type { WidgetImpl } from "../types";
import { OVERVIEW_WIDGETS } from "./overview";

export { cached } from "./cache";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const WIDGET_IMPLS = {
  ...OVERVIEW_WIDGETS,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<WidgetKey, WidgetImpl<any>>;
