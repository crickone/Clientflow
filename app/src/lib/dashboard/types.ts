import type { ReactNode } from "react";
import type { RangeKey, ResolvedRange, StoredRangeKey } from "./range";
import type { getVocab } from "@/lib/vocabulary";

export type WidgetSize = "S" | "M" | "L" | "XL";
export const SIZE_SPAN: Record<WidgetSize, number> = { S: 1, M: 2, L: 3, XL: 4 };
export const SIZE_ORDER: readonly WidgetSize[] = ["S", "M", "L", "XL"];

export type Domain =
  | "overview"
  | "sales"
  | "marketing"
  | "email"
  | "communication"
  | "frontdesk"
  | "classes"
  | "finance"
  | "content"
  | "website"
  | "competitors"
  | "ai";

export const DOMAIN_LABELS: Record<Domain, string> = {
  overview: "Overview",
  sales: "Sales",
  marketing: "Marketing",
  email: "Email",
  communication: "Communication",
  frontdesk: "Front desk",
  classes: "Classes",
  finance: "Finance",
  content: "Content & Social",
  website: "Website",
  competitors: "Competitors",
  ai: "AI & Usage",
};

/** Something a tenant must have set up before a widget can show data. */
export type Requirement = "site" | "sendingDomain" | "competitors";
export type { RecorderKey } from "@/lib/recorders/started";
import type { RecorderKey } from "@/lib/recorders/started";

export type Sensitivity = "general" | "financial" | "spend";
export type Venue = "clinic" | "gym";
/** tab = follows the tab range; pinned = always `pinnedRange`; none = not time-based. */
export type RangeMode = "tab" | "pinned" | "none";

export interface WidgetMeta {
  key: string;
  title: string;
  description: string;
  domain: Domain;
  sizes: readonly WidgetSize[];
  defaultSize: WidgetSize;
  venues: readonly Venue[];
  sensitivity: Sensitivity;
  rangeMode: RangeMode;
  pinnedRange?: StoredRangeKey;
  /** Unmet requirement renders a call-to-action instead of loading the widget. */
  requires?: readonly Requirement[];
  /** Event recorder backing this widget; drives the "Collecting since" note. */
  recorder?: RecorderKey;
}

/** One widget as saved on a tab. */
export interface WidgetRef {
  key: string;
  size: WidgetSize;
  /** Per-widget override of the tab range (only for rangeMode "tab"). */
  range?: StoredRangeKey;
}

export interface WidgetCtx {
  venue: Venue;
  vocab: ReturnType<typeof getVocab>;
  range: ResolvedRange;
  previous: ResolvedRange;
  now: Date;
  tenantId: number;
  /** When the given recorder started collecting for this tenant, or null. */
  recorderStart: (key: RecorderKey) => Date | null;
  /** Per-request memo shared by every widget on the page. */
  cache: Map<string, Promise<unknown>>;
}

export interface WidgetImpl<T = unknown> {
  /** Title override that needs tenant vocabulary; falls back to meta.title. */
  label?: (ctx: WidgetCtx) => string;
  /** Click-through for the tile header. */
  href?: string;
  load(ctx: WidgetCtx): Promise<T>;
  render(data: T, ctx: WidgetCtx): ReactNode;
}

export type { RangeKey };
