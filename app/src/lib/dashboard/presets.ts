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
  {
    key: "sales",
    name: "Sales",
    description: "Pipeline health, conversion and where your best leads come from.",
    icon: "TrendingUp",
    widgets: {
      clinic: [
        { key: "sales.newLeads", size: "S" },
        { key: "sales.conversionRate", size: "S" },
        { key: "sales.wonThisPeriod", size: "S" },
        { key: "sales.openPipeline", size: "S" },
        { key: "sales.funnel", size: "XL" },
        { key: "sales.stageDistribution", size: "M" },
        { key: "sales.timeInStage", size: "M" },
        { key: "sales.leadsBySource", size: "M" },
        { key: "sales.conversionBySource", size: "M" },
        { key: "sales.conversionByService", size: "M" },
        { key: "sales.leadsByCampaign", size: "M" },
        { key: "sales.staleLeads", size: "L" },
        { key: "sales.slaBreaches", size: "S" },
        { key: "sales.wonLostTrend", size: "L" },
        { key: "sales.velocity", size: "S" },
      ],
      gym: [
        { key: "sales.newLeads", size: "S" },
        { key: "sales.conversionRate", size: "S" },
        { key: "sales.wonThisPeriod", size: "S" },
        { key: "sales.openPipeline", size: "S" },
        { key: "sales.funnel", size: "XL" },
        { key: "sales.stageDistribution", size: "M" },
        { key: "sales.timeInStage", size: "M" },
        { key: "sales.leadsBySource", size: "M" },
        { key: "sales.conversionBySource", size: "M" },
        { key: "sales.conversionByService", size: "M" },
        { key: "sales.leadsByCampaign", size: "M" },
        { key: "sales.staleLeads", size: "L" },
        { key: "sales.slaBreaches", size: "S" },
        { key: "sales.wonLostTrend", size: "L" },
        { key: "sales.velocity", size: "S" },
      ],
    },
  },
  {
    key: "marketing",
    name: "Marketing",
    description: "Campaign returns, website traffic and what is coming up.",
    icon: "Megaphone",
    widgets: {
      clinic: [
        { key: "marketing.activeCampaigns", size: "S" },
        { key: "marketing.campaignLeads", size: "S" },
        { key: "marketing.blendedCac", size: "S" },
        { key: "marketing.roas", size: "S" },
        { key: "marketing.scoreboard", size: "XL" },
        { key: "marketing.landingFunnel", size: "L" },
        { key: "marketing.formSubmissions", size: "S" },
        { key: "marketing.visitorsTrend", size: "L" },
        { key: "marketing.ratingGap", size: "S" },
        { key: "marketing.trafficSources", size: "M" },
        { key: "marketing.upcomingSends", size: "M" },
        { key: "marketing.seasonalDates", size: "M" },
      ],
      gym: [
        { key: "marketing.activeCampaigns", size: "S" },
        { key: "marketing.campaignLeads", size: "S" },
        { key: "marketing.blendedCac", size: "S" },
        { key: "marketing.roas", size: "S" },
        { key: "marketing.scoreboard", size: "XL" },
        { key: "marketing.landingFunnel", size: "L" },
        { key: "marketing.formSubmissions", size: "S" },
        { key: "marketing.visitorsTrend", size: "L" },
        { key: "marketing.ratingGap", size: "S" },
        { key: "marketing.trafficSources", size: "M" },
        { key: "marketing.upcomingSends", size: "M" },
        { key: "marketing.seasonalDates", size: "M" },
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
