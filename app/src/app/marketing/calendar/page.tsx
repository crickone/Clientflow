import { requireAdminPage, getCurrentMembership } from "@/lib/auth";
import { listCampaigns } from "@/lib/campaigns/store";
import { getCampaignRadar } from "@/lib/marketing/campaignRadar";
import { catalogForYear } from "@/lib/marketing/seasonalCalendar";
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

  // Number(undefined) / Number("") is NaN (falsy) -> current year, matching
  // the brief's `Number(searchParams.year) || currentYear` exactly for every
  // absent/empty/non-numeric case; Math.trunc + a sane range additionally
  // guards a fractional or wildly out-of-range value (e.g. `?year=2026.5`)
  // from reaching catalogForYear's date math.
  const parsedYear = Math.trunc(Number(searchParams.year));
  const year = Number.isFinite(parsedYear) && parsedYear > 1900 && parsedYear < 2200 ? parsedYear : new Date().getUTCFullYear();

  const { dates, seasons } = catalogForYear(year);
  const campaigns = listCampaigns();
  const radar = await getCampaignRadar(tenantId);

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Marketing"
        title="Seasonal calendar"
        subtitle="Irish holidays, awareness days and seasons for the year, overlaid with your campaigns — plus what's coming up next."
      />
      <SeasonalCalendar year={year} dates={dates} seasons={seasons} campaigns={campaigns} radar={radar} />
    </div>
  );
}
