import type { WidgetKey } from "../catalog";
export type OverviewKey = Extract<WidgetKey, `overview.${string}`>;
export type SalesKey = Extract<WidgetKey, `sales.${string}`>;
