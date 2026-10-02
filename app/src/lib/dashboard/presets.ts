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
  /** Venues this preset applies to; omitted means both. Its list is empty for any other venue. */
  venues?: readonly Venue[];
  widgets: Record<Venue, WidgetRef[]>;
}

export const ALL_VENUES: readonly Venue[] = ["clinic", "gym"];

export function presetAppliesTo(p: Preset, venue: Venue): boolean {
  return (p.venues ?? ALL_VENUES).includes(venue);
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
  {
    key: "email",
    name: "Email",
    description: "List health, campaign results and deliverability.",
    icon: "Mail",
    widgets: {
      clinic: [
        { key: "email.subscribers", size: "S" },
        { key: "email.openRate", size: "S" },
        { key: "email.clickRate", size: "S" },
        { key: "email.credits", size: "S" },
        { key: "email.listGrowth", size: "L" },
        { key: "email.sendsThisMonth", size: "S" },
        { key: "email.campaignTable", size: "XL" },
        { key: "email.engagementTrend", size: "XL" },
        { key: "email.topLinks", size: "M" },
        { key: "email.sendTimeHeatmap", size: "M" },
        { key: "email.deliverability", size: "M" },
        { key: "email.statusMix", size: "M" },
        { key: "email.suppressions", size: "M" },
        { key: "email.contactSources", size: "M" },
      ],
      gym: [
        { key: "email.subscribers", size: "S" },
        { key: "email.openRate", size: "S" },
        { key: "email.clickRate", size: "S" },
        { key: "email.credits", size: "S" },
        { key: "email.listGrowth", size: "L" },
        { key: "email.sendsThisMonth", size: "S" },
        { key: "email.campaignTable", size: "XL" },
        { key: "email.engagementTrend", size: "XL" },
        { key: "email.topLinks", size: "M" },
        { key: "email.sendTimeHeatmap", size: "M" },
        { key: "email.deliverability", size: "M" },
        { key: "email.statusMix", size: "M" },
        { key: "email.suppressions", size: "M" },
        { key: "email.contactSources", size: "M" },
      ],
    },
  },
  {
    key: "communication",
    name: "Communication",
    description: "Inbox volume, how fast you reply and what people ask about.",
    icon: "MessagesSquare",
    widgets: {
      clinic: [
        { key: "communication.unread", size: "S" },
        { key: "communication.inbound", size: "S" },
        { key: "communication.firstResponse", size: "S" },
        { key: "communication.autoReplyRate", size: "S" },
        { key: "communication.inOutTrend", size: "L" },
        { key: "communication.priorityMix", size: "S" },
        { key: "communication.byChannel", size: "M" },
        { key: "communication.responseByChannel", size: "M" },
        { key: "communication.triageCategories", size: "M" },
        { key: "communication.busiestHours", size: "M" },
        { key: "communication.awaitingReply", size: "XL" },
        { key: "communication.topTags", size: "M" },
        { key: "communication.automations", size: "M" },
      ],
      gym: [
        { key: "communication.unread", size: "S" },
        { key: "communication.inbound", size: "S" },
        { key: "communication.firstResponse", size: "S" },
        { key: "communication.autoReplyRate", size: "S" },
        { key: "communication.inOutTrend", size: "L" },
        { key: "communication.priorityMix", size: "S" },
        { key: "communication.byChannel", size: "M" },
        { key: "communication.responseByChannel", size: "M" },
        { key: "communication.triageCategories", size: "M" },
        { key: "communication.busiestHours", size: "M" },
        { key: "communication.awaitingReply", size: "XL" },
        { key: "communication.topTags", size: "M" },
        { key: "communication.automations", size: "M" },
      ],
    },
  },
  {
    key: "frontdesk",
    name: "Front desk",
    description: "Today's diary, no-shows, busy times and what needs a nudge.",
    icon: "CalendarCheck",
    venues: ["clinic"],
    widgets: {
      clinic: [
        { key: "overview.todaysBookings", size: "S" },
        { key: "frontdesk.weekBookings", size: "S" },
        { key: "frontdesk.noShowRate", size: "S" },
        { key: "frontdesk.cancellationRate", size: "S" },
        { key: "overview.todaysSchedule", size: "L" },
        { key: "frontdesk.birthdays", size: "S" },
        { key: "frontdesk.utilisation", size: "M" },
        { key: "frontdesk.busiestTimes", size: "M" },
        { key: "frontdesk.sessionsByService", size: "M" },
        { key: "frontdesk.newVsReturning", size: "M" },
        { key: "frontdesk.cancelLeadTime", size: "M" },
        { key: "frontdesk.creditsExpiring", size: "M" },
      ],
      gym: [],
    },
  },
  {
    key: "classes",
    name: "Classes",
    description: "Fill, attendance and who has gone quiet.",
    icon: "Dumbbell",
    venues: ["gym"],
    widgets: {
      clinic: [],
      gym: [
        { key: "overview.classesThisWeek", size: "S" },
        { key: "classes.avgFill", size: "S" },
        { key: "classes.attendanceRate", size: "S" },
        { key: "classes.noShows", size: "S" },
        { key: "overview.todaysClasses", size: "L" },
        { key: "classes.newBookings", size: "S" },
        { key: "classes.fillByType", size: "M" },
        { key: "classes.fillBySlot", size: "M" },
        { key: "classes.instructors", size: "M" },
        { key: "classes.fullClasses", size: "M" },
        { key: "classes.inactiveMembers", size: "M" },
      ],
    },
  },
  {
    key: "finance",
    name: "Finance",
    description: "Money in, how people pay, and what is owed or coming up.",
    icon: "Wallet",
    widgets: {
      clinic: [
        { key: "finance.revenue", size: "S" },
        { key: "overview.cashToday", size: "S" },
        { key: "overview.deferredRevenue", size: "S" },
        { key: "finance.avgSpend", size: "S" },
        { key: "finance.revenueTrend", size: "XL" },
        { key: "finance.byMethod", size: "M" },
        { key: "finance.byService", size: "M" },
        { key: "finance.topClients", size: "M" },
        { key: "finance.packages", size: "M" },
        { key: "finance.vouchers", size: "M" },
      ],
      gym: [
        { key: "finance.revenue", size: "S" },
        { key: "overview.mrr", size: "S" },
        { key: "finance.churn", size: "S" },
        { key: "finance.avgSpend", size: "S" },
        { key: "finance.revenueTrend", size: "XL" },
        { key: "finance.byMethod", size: "M" },
        { key: "finance.topClients", size: "M" },
        { key: "finance.membersGainedLost", size: "XL" },
        { key: "finance.renewals", size: "M" },
        { key: "finance.vouchers", size: "M" },
      ],
    },
  },
];

export const PRESET_BY_KEY: Map<string, Preset> = new Map(PRESETS.map((p) => [p.key, p]));

/** A fresh copy of a preset's layout for a venue, or null for an unknown preset. */
export function presetWidgets(key: string, venue: Venue): WidgetRef[] | null {
  const p = PRESET_BY_KEY.get(key);
  return p && presetAppliesTo(p, venue) ? p.widgets[venue].map((r) => ({ ...r })) : null;
}
