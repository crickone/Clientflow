import "server-only";

import type { WidgetKey } from "../catalog";
import type { WidgetImpl } from "../types";
import { AI_WIDGETS } from "./ai";
import { CLASSES_WIDGETS } from "./classes";
import { COMPETITORS_WIDGETS } from "./competitors";
import { FINANCE_WIDGETS } from "./finance";
import { FRONTDESK_WIDGETS } from "./frontdesk";
import { OVERVIEW_WIDGETS } from "./overview";
import { COMMUNICATION_WIDGETS } from "./communication";
import { CONTENT_WIDGETS } from "./content";
import { EMAIL_WIDGETS } from "./email";
import { MARKETING_WIDGETS } from "./marketing";
import { SALES_WIDGETS } from "./sales";
import { WEBSITE_WIDGETS } from "./website";

export { cached } from "./cache";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const WIDGET_IMPLS = {
  ...OVERVIEW_WIDGETS,
  ...SALES_WIDGETS,
  ...MARKETING_WIDGETS,
  ...EMAIL_WIDGETS,
  ...COMMUNICATION_WIDGETS,
  ...FRONTDESK_WIDGETS,
  ...CLASSES_WIDGETS,
  ...FINANCE_WIDGETS,
  ...CONTENT_WIDGETS,
  ...WEBSITE_WIDGETS,
  ...COMPETITORS_WIDGETS,
  ...AI_WIDGETS,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<WidgetKey, WidgetImpl<any>>;
