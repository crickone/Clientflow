import type { WidgetKey } from "../catalog";
export type OverviewKey = Extract<WidgetKey, `overview.${string}`>;
export type SalesKey = Extract<WidgetKey, `sales.${string}`>;
export type MarketingKey = Extract<WidgetKey, `marketing.${string}`>;
export type EmailKey = Extract<WidgetKey, `email.${string}`>;
export type CommunicationKey = Extract<WidgetKey, `communication.${string}`>;
export type FrontdeskKey = Extract<WidgetKey, `frontdesk.${string}`>;
export type ClassesKey = Extract<WidgetKey, `classes.${string}`>;
export type FinanceKey = Extract<WidgetKey, `finance.${string}`>;
