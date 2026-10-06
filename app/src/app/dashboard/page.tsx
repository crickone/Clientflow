import { Suspense } from "react";
import Link from "next/link";
import { CalendarPlus, Plus } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { DailyBrief } from "@/components/dashboard/DailyBrief";
import { SetupProgressCard } from "@/components/dashboard/SetupProgressCard";
import { DashboardGrid, type CatalogEntry, type GridItem } from "@/components/dashboard/DashboardGrid";
import { TabBar } from "@/components/dashboard/TabBar";
import { WidgetErrorBoundary } from "@/components/dashboard/WidgetErrorBoundary";
import { RequirementCta } from "@/components/dashboard/views/RequirementCta";
import { WidgetSlot } from "@/components/dashboard/WidgetSlot";
import { getCurrentMembership } from "@/lib/auth";
import { isBriefComplete } from "@/lib/businessProfile";
import { CATALOG, CATALOG_BY_KEY } from "@/lib/dashboard/catalog";
import { PRESETS, presetAppliesTo } from "@/lib/dashboard/presets";
import { parseRangeKey, previousRange, resolveRange, type RangeKey } from "@/lib/dashboard/range";
import { resolveTabs } from "@/lib/dashboard/tabs";
import { checkRequirements } from "@/lib/dashboard/requirements";
import { DOMAIN_LABELS, type RecorderKey, type Requirement, type Venue, type WidgetCtx, type WidgetMeta } from "@/lib/dashboard/types";
import { appliesToVenue, canSee, visibleRefs } from "@/lib/dashboard/visibility";
import { getVisibilityOverrides } from "@/lib/dashboard/visibilityStore";
import { WIDGET_IMPLS } from "@/lib/dashboard/widgets";
import { getCurrentTenant } from "@/lib/db/tenant";
import { getRecorderStart } from "@/lib/recorders/startedStore";
import { getSchedulingMode, getVenueType } from "@/lib/settings";
import { getSetupSummary, isSetupDismissed, setSetupDismissed } from "@/lib/setup/steps";
import { getVocab } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { tab?: string; range?: string; from?: string; to?: string };
}) {
  const membership = getCurrentMembership();
  if (!membership) return null; // the layout already redirects signed-out users
  const vocab = getVocab(getVenueType());
  const tenantId = getCurrentTenant().id;
  const venue: Venue = getSchedulingMode() === "timetable" ? "gym" : "clinic";
  const isAdmin = membership.role === "admin";
  const briefComplete = isBriefComplete();
  const setup = isAdmin && !isSetupDismissed() ? getSetupSummary() : null;
  if (setup?.allResolved) setSetupDismissed(true);

  const { tabs, source } = resolveTabs(membership.user.id, venue);
  const requested = Number.parseInt(searchParams.tab ?? "0", 10);
  const active = Number.isInteger(requested) && requested >= 0 && requested < tabs.length ? requested : 0;
  const tab = tabs[active];

  const now = new Date();
  const rangeKey: RangeKey = parseRangeKey(searchParams.range) ?? tab.range;
  const custom = { from: searchParams.from, to: searchParams.to };
  const tabRange = resolveRange(rangeKey, now, custom);
  const overrides = getVisibilityOverrides();
  const refs = visibleRefs(tab.widgets, { venue, role: membership.role, overrides });
  const cache = new Map<string, Promise<unknown>>();
  const startMemo = new Map<RecorderKey, Date | null>();
  const recorderStart = (key: RecorderKey): Date | null => {
    if (!startMemo.has(key)) startMemo.set(key, getRecorderStart(key));
    return startMemo.get(key) ?? null;
  };
  const needsReqs = refs.some((r) => (CATALOG_BY_KEY.get(r.key)?.requires?.length ?? 0) > 0);
  const reqs = needsReqs ? await checkRequirements(tenantId) : ({} as Awaited<ReturnType<typeof checkRequirements>>);

  const items: GridItem[] = refs.map((ref) => {
    const meta = CATALOG_BY_KEY.get(ref.key)!;
    const range =
      meta.rangeMode === "pinned" && meta.pinnedRange
        ? resolveRange(meta.pinnedRange, now)
        : ref.range
          ? resolveRange(ref.range, now)
          : tabRange;
    const ctx: WidgetCtx = { venue, vocab, range, previous: previousRange(range), now, cache, tenantId, recorderStart };
    const unmet = (meta.requires as readonly Requirement[] | undefined)?.find((r) => !reqs[r]);
    const impl = (WIDGET_IMPLS as Record<string, { label?: (c: WidgetCtx) => string; href?: string }>)[ref.key];
    return {
      ref,
      title: impl?.label?.(ctx) ?? meta.title,
      href: impl?.href,
      node: unmet ? (
        <RequirementCta requirement={unmet} />
      ) : (
        <WidgetErrorBoundary>
          <Suspense fallback={<Skeleton height={ref.size === "L" || ref.size === "XL" ? 120 : 48} />}>
            <WidgetSlot widgetKey={ref.key} ctx={ctx} tenantId={tenantId} />
          </Suspense>
        </WidgetErrorBoundary>
      ),
    };
  });

  const catalog: CatalogEntry[] = (CATALOG as readonly WidgetMeta[])
    .filter((m) => appliesToVenue(m, venue) && canSee(m, membership.role, overrides))
    .map((m) => ({
      key: m.key,
      title: m.title,
      description: m.description,
      domain: m.domain,
      sizes: m.sizes,
      defaultSize: m.defaultSize,
      domainLabel: DOMAIN_LABELS[m.domain],
    }));

  const presets = PRESETS.filter((p) => presetAppliesTo(p, venue)).map((p) => ({
    key: p.key,
    name: p.name,
    description: p.description,
    icon: p.icon,
    count: visibleRefs(p.widgets[venue], { venue, role: membership.role, overrides }).length,
  })).filter((p) => p.count > 0);

  const showNeedsAbove = !refs.some((r) => r.key === "overview.needsYou");
  const dateLine = now.toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Dublin" });

  return (
    <div className="app-page">
      <header className="dash-head">
        <div style={{ minWidth: 0 }}>
          <div className="dash-date">{dateLine}</div>
          <h1 className="dash-greeting">{greeting(now, membership.user.name)}</h1>
        </div>
        <div className="dash-head-actions">
          <Link href="/adonis">
            <Button variant="outline">Ask Adonis</Button>
          </Link>
          {venue === "gym" ? (
            <Link href="/clients/new">
              <Button>
                <Plus size={15} /> Add member
              </Button>
            </Link>
          ) : (
            <Link href="/appointments/new">
              <Button>
                <CalendarPlus size={15} /> {vocab.bookCta}
              </Button>
            </Link>
          )}
        </div>
      </header>

      {((setup && !setup.allResolved) || (isAdmin && !briefComplete)) && (
        <SetupProgressCard
          setup={setup && !setup.allResolved ? { requiredDone: setup.requiredDone, requiredTotal: setup.requiredTotal, nextHref: setup.nextHref, nextTitle: setup.nextTitle } : null}
          briefMissing={isAdmin && !briefComplete}
        />
      )}

      {showNeedsAbove && <DailyBrief tenantId={tenantId} />}

      <TabBar
        tabs={tabs.map((t) => ({ name: t.name, presetKey: t.presetKey }))}
        active={active}
        rangeKey={tabRange.key}
        rangeLabel={tabRange.label}
        isAdmin={isAdmin}
        source={source}
        presets={presets}
        custom={tabRange.key === "custom" ? { from: tabRange.fromIso, to: tabRange.toIso } : undefined}
      />

      <DashboardGrid key={`${active}:${tab.widgets.map((w) => w.key + w.size).join(",")}`} tabIndex={active} items={items} catalog={catalog} />
    </div>
  );
}

/** "Good afternoon, Christopher" in Irish time; the first name only, or none. */
function greeting(now: Date, name: string | null | undefined): string {
  const hour = Number(new Intl.DateTimeFormat("en-IE", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Dublin" }).format(now));
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}
