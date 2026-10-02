import "server-only";

import type { WidgetKey } from "../catalog";
import type { WidgetImpl } from "../types";
import { OVERVIEW_WIDGETS } from "./overview";
import { COMMUNICATION_WIDGETS } from "./communication";
import { EMAIL_WIDGETS } from "./email";
import { MARKETING_WIDGETS } from "./marketing";
import { SALES_WIDGETS } from "./sales";

export { cached } from "./cache";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const WIDGET_IMPLS = {
  ...OVERVIEW_WIDGETS,
  ...SALES_WIDGETS,
  ...MARKETING_WIDGETS,
  ...EMAIL_WIDGETS,
  ...COMMUNICATION_WIDGETS,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<WidgetKey, WidgetImpl<any>>;
