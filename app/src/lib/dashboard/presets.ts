/**
 * Dashboard presets: named starting layouts a user adds as a tab. Plain
 * data, one layout per venue. Slice 1 ships Overview only; slices 3 and 4
 * append the domain presets here.
 *
 * Pure: no DB, no server imports.
 */
import type { Venue, WidgetRef } from "./types";

export type PresetIcon =
  | "LayoutDashboard"
  | "TrendingUp"
  | "Megaphone"
  | "Mail"
  | "MessagesSquare"
  | "CalendarCheck"
  | "Dumbbell"
  | "Wallet"
  | "Images"
  | "Globe"
  | "Binoculars"
  | "Cpu";

export interface Preset {
  key: string;
  name: string;
  description: string;
  icon: PresetIcon;
  widgets: Record<Venue, WidgetRef[]>;
}

export const OVERVIEW_PRESET_KEY = "overview";

export const PRESETS: Preset[] = [
  {
    key: OVERVIEW_PRESET_KEY,
    name: "Overview",
    description: "Today at a glance: bookings, leads, messages, revenue and what needs attention.",
    icon: "LayoutDashboard",
    widgets: {
      clinic: [
        { key: "overview.todaysBookings", size: "S" },
        { key: "overview.todaysEarnings", size: "S" },
        { key: "overview.cashToday", size: "S" },
        { key: "overview.deferredRevenue", size: "S" },
        { key: "overview.activeClients", size: "S" },
        { key: "overview.plansExpiring", size: "S" },
        { key: "overview.newLeads", size: "S" },
        { key: "overview.unreadMessages", size: "S" },
        { key: "overview.needsAttention", size: "XL" },
        { key: "overview.todaysSchedule", size: "L" },
        { key: "overview.recentActivity", size: "S" },
        { key: "overview.revenueTrend", size: "XL" },
        { key: "overview.pipelineSnapshot", size: "M" },
        { key: "overview.upcomingPosts", size: "M" },
      ],
      gym: [
        { key: "overview.activeMembers", size: "S" },
        { key: "overview.mrr", size: "S" },
        { key: "overview.classesThisWeek", size: "S" },
        { key: "overview.attendance", size: "S" },
        { key: "overview.newLeads", size: "S" },
        { key: "overview.unreadMessages", size: "S" },
        { key: "overview.pipelineSnapshot", size: "M" },
        { key: "overview.needsAttention", size: "XL" },
        { key: "overview.todaysClasses", size: "L" },
        { key: "overview.recentActivity", size: "S" },
        { key: "overview.revenueTrend", size: "XL" },
        { key: "overview.upcomingPosts", size: "M" },
      ],
    },
  },
];

export const PRESET_BY_KEY: Map<string, Preset> = new Map(PRESETS.map((p) => [p.key, p]));

/** A fresh copy of a preset's layout for a venue, or null for an unknown preset. */
export function presetWidgets(key: string, venue: Venue): WidgetRef[] | null {
  const p = PRESET_BY_KEY.get(key);
  return p ? p.widgets[venue].map((r) => ({ ...r })) : null;
}
