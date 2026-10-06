import { requireAdminPage, getCurrentMembership } from "@/lib/auth";
import { listCampaigns } from "@/lib/campaigns/store";
import { getCampaignRadar } from "@/lib/marketing/campaignRadar";
import { monthsToShow } from "@/lib/marketing/calendarRules";
import { buildCalendarView } from "@/lib/marketing/calendarView";
import { PageHeader } from "@/components/layout/PageHeader";
import { SeasonalCalendar } from "@/components/marketing/SeasonalCalendar";

export const dynamic = "force-dynamic";

// Campaign Engine Slice 3 (Task 3): the visible seasonal calendar — Irish
// marketing dates + seasons overlaid with the tenant's real campaigns, plus
// an AI-radar "coming up" rail. Admin-gated the same way (and for the same
// reason) as its sibling /marketing/campaigns hub — see that page's comment
// on requireAdminPage + Sidebar.tsx's Marketing nav note.
export default async function MarketingCalendarPage({
  searchParams,
}: {
  searchParams: { year?: string };
}) {
  await requireAdminPage();
  // requireAdminPage() guarantees an admin membership in the active tenant —
  // same idiom as /agents/[key]/page.tsx's `getCurrentMembership()!.tenant.id`.
  // This MUST be the session's own resolved tenant: getCampaignRadar metres
  // its AI call against whatever tenantId it's given, but grounds the prompt
  // itself on the AMBIENT tenant (the request's cookie-resolved db proxy,
  // same as listCampaigns() below) — if the two ever diverged, a tenant
  // could be metered for another tenant's business context, or vice versa.
  // There's no tenantId anywhere in this page's input (searchParams only
  // ever carries `year`, a plain int), so it can only ever be this session's
  // own tenant — never a URL/query value.
  const tenantId = getCurrentMembership()!.tenant.id;

  // Always a calendar year, January to December, so everyone sees the same
  // calendar: this year by default, ?year=2027 for another.
  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin" }).format(new Date());
  const parsedYear = Math.trunc(Number(searchParams.year));
  const year = Number.isFinite(parsedYear) && parsedYear > 1900 && parsedYear < 2200 ? parsedYear : Number(todayIso.slice(0, 4));
  const months = monthsToShow({ year });

  const campaigns = listCampaigns();
  const [radar, view] = await Promise.all([getCampaignRadar(tenantId), buildCalendarView(months, campaigns, todayIso)]);

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Marketing"
        title="Seasonal calendar"
        subtitle="Irish holidays, school dates and your own dates, with the campaigns you have for each."
      />
      <SeasonalCalendar year={year} todayIso={todayIso} view={view} radar={radar} />
    </div>
  );
}
