/**
 * Every dashboard widget's metadata, in one pure list. Implementations live
 * in ./widgets/*.tsx and are keyed by the same `key`; ./widgets/index.ts
 * uses `satisfies Record<WidgetKey, WidgetImpl>` so a catalog entry without
 * an implementation (or the reverse) fails typecheck.
 *
 * Pure: no DB, no server imports (the tests and the client bundle read it).
 */
import { STORED_RANGE_KEYS, type StoredRangeKey } from "./range";
import { SIZE_SPAN, type WidgetMeta, type WidgetRef, type WidgetSize } from "./types";

export const MAX_WIDGETS_PER_TAB = 40;
export const MAX_TABS_PER_USER = 20;

export const CATALOG = [
  // -- Overview: clinic --
  {
    key: "overview.todaysBookings",
    title: "Today's bookings",
    description: "Bookings on today's diary, split by confirmed and pending.",
    domain: "overview",
    sizes: ["S", "M"],
    defaultSize: "S",
    venues: ["clinic"],
    sensitivity: "general",
    rangeMode: "pinned",
    pinnedRange: "today",
  },
  {
    key: "overview.todaysEarnings",
    title: "Today's earnings",
    description: "Value of sessions completed today.",
    domain: "overview",
    sizes: ["S", "M"],
    defaultSize: "S",
    venues: ["clinic"],
    sensitivity: "financial",
    rangeMode: "pinned",
    pinnedRange: "today",
  },
  {
    key: "overview.cashToday",
    title: "Cash today",
    description: "Payments recorded on the till today.",
    domain: "overview",
    sizes: ["S", "M"],
    defaultSize: "S",
    venues: ["clinic"],
    sensitivity: "financial",
    rangeMode: "pinned",
    pinnedRange: "today",
  },
  {
    key: "overview.deferredRevenue",
    title: "Deferred revenue",
    description: "Unused package credits plus open voucher balances.",
    domain: "overview",
    sizes: ["S", "M"],
    defaultSize: "S",
    venues: ["clinic"],
    sensitivity: "financial",
    rangeMode: "none",
  },
  {
    key: "overview.activeClients",
    title: "Active clients",
    description: "Clients who visited in the last 90 days.",
    domain: "overview",
    sizes: ["S", "M"],
    defaultSize: "S",
    venues: ["clinic"],
    sensitivity: "general",
    rangeMode: "none",
  },
  {
    key: "overview.plansExpiring",
    title: "Plans expiring",
    description: "Packages expiring in the next 30 days.",
    domain: "overview",
    sizes: ["S", "M"],
    defaultSize: "S",
    venues: ["clinic"],
    sensitivity: "general",
    rangeMode: "none",
  },
  {
    key: "overview.todaysSchedule",
    title: "Today's schedule",
    description: "Every booking on today's diary with its therapies and status.",
    domain: "overview",
    sizes: ["M", "L", "XL"],
    defaultSize: "L",
    venues: ["clinic"],
    sensitivity: "general",
    rangeMode: "pinned",
    pinnedRange: "today",
  },
  // -- Overview: gym --
  {
    key: "overview.activeMembers",
    title: "Active members",
    description: "Members on an active membership.",
    domain: "overview",
    sizes: ["S", "M"],
    defaultSize: "S",
    venues: ["gym"],
    sensitivity: "general",
    rangeMode: "none",
  },
  {
    key: "overview.mrr",
    title: "Monthly recurring",
    description: "Monthly recurring revenue from active memberships.",
    domain: "overview",
    sizes: ["S", "M"],
    defaultSize: "S",
    venues: ["gym"],
    sensitivity: "financial",
    rangeMode: "none",
  },
  {
    key: "overview.classesThisWeek",
    title: "Classes this week",
    description: "Classes scheduled Monday to Sunday this week.",
    domain: "overview",
    sizes: ["S", "M"],
    defaultSize: "S",
    venues: ["gym"],
    sensitivity: "general",
    rangeMode: "none",
  },
  {
    key: "overview.attendance",
    title: "Attendance",
    description: "Share of class bookings attended over the last 30 days.",
    domain: "overview",
    sizes: ["S", "M"],
    defaultSize: "S",
    venues: ["gym"],
    sensitivity: "general",
    rangeMode: "none",
  },
  {
    key: "overview.todaysClasses",
    title: "Today's classes",
    description: "Today's classes with how full each one is.",
    domain: "overview",
    sizes: ["M", "L", "XL"],
    defaultSize: "L",
    venues: ["gym"],
    sensitivity: "general",
    rangeMode: "pinned",
    pinnedRange: "today",
  },
  // -- Overview: both venues --
  {
    key: "overview.newLeads",
    title: "New leads",
    description: "Leads created in the period, with the change on the previous period.",
    domain: "overview",
    sizes: ["S", "M"],
    defaultSize: "S",
    venues: ["clinic", "gym"],
    sensitivity: "general",
    rangeMode: "tab",
  },
  {
    key: "overview.unreadMessages",
    title: "Unread messages",
    description: "Inbound emails nobody has opened yet.",
    domain: "overview",
    sizes: ["S", "M"],
    defaultSize: "S",
    venues: ["clinic", "gym"],
    sensitivity: "general",
    rangeMode: "none",
  },
  {
    key: "overview.needsAttention",
    title: "Needs attention",
    description: "Unread email and leads waiting for a first follow-up.",
    domain: "overview",
    sizes: ["L", "XL"],
    defaultSize: "XL",
    venues: ["clinic", "gym"],
    sensitivity: "general",
    rangeMode: "none",
  },
  {
    key: "overview.recentActivity",
    title: "Recent activity",
    description: "The latest things that happened across the account.",
    domain: "overview",
    sizes: ["S", "M", "L"],
    defaultSize: "S",
    venues: ["clinic", "gym"],
    sensitivity: "general",
    rangeMode: "none",
  },
  {
    key: "overview.revenueTrend",
    title: "Revenue trend",
    description: "Revenue per day from completed sessions, against the previous period.",
    domain: "overview",
    sizes: ["L", "XL"],
    defaultSize: "XL",
    venues: ["clinic", "gym"],
    sensitivity: "financial",
    rangeMode: "tab",
  },
  {
    key: "overview.pipelineSnapshot",
    title: "Pipeline snapshot",
    description: "How many leads sit in each stage of your main pipeline right now.",
    domain: "overview",
    sizes: ["M", "L", "XL"],
    defaultSize: "M",
    venues: ["clinic", "gym"],
    sensitivity: "general",
    rangeMode: "none",
  },
  {
    key: "overview.upcomingPosts",
    title: "Upcoming posts",
    description: "The next social posts scheduled to go out.",
    domain: "overview",
    sizes: ["M", "L"],
    defaultSize: "M",
    venues: ["clinic", "gym"],
    sensitivity: "general",
    rangeMode: "none",
  },
] as const satisfies readonly WidgetMeta[];

export type WidgetKey = (typeof CATALOG)[number]["key"];

export const CATALOG_BY_KEY: Map<string, WidgetMeta> = new Map(
  (CATALOG as readonly WidgetMeta[]).map((m) => [m.key, m]),
);

/**
 * Validate an untrusted layout (from a server action) against the catalog.
 * Throws with a readable message on the first problem; returns a clean copy.
 */
export function validateLayout(input: unknown): WidgetRef[] {
  if (!Array.isArray(input)) throw new Error("Layout must be a list of widgets.");
  if (input.length > MAX_WIDGETS_PER_TAB) {
    throw new Error(`A tab can hold at most ${MAX_WIDGETS_PER_TAB} widgets.`);
  }
  return input.map((raw, i) => {
    const r = raw as Partial<WidgetRef> | null;
    const meta = r && typeof r.key === "string" ? CATALOG_BY_KEY.get(r.key) : undefined;
    if (!meta) throw new Error(`Unknown widget at position ${i + 1}.`);
    const size = r!.size as WidgetSize;
    if (!(size in SIZE_SPAN) || !meta.sizes.includes(size)) {
      throw new Error(`${meta.title} does not come in size ${String(r!.size)}.`);
    }
    const out: WidgetRef = { key: meta.key, size };
    if (r!.range !== undefined) {
      if (!(STORED_RANGE_KEYS as readonly string[]).includes(r!.range as string) || meta.rangeMode !== "tab") {
        throw new Error(`${meta.title} cannot use range ${String(r!.range)}.`);
      }
      out.range = r!.range as StoredRangeKey;
    }
    return out;
  });
}
