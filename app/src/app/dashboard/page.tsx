import Link from "next/link";
import { CalendarPlus, Plus, Sparkles, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardLabel, CardValue } from "@/components/ui/Card";
import { Reveal, RevealGroup } from "@/components/motion/Reveal";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { RevenueBars } from "@/components/charts/RevenueBars";
import { DailyBrief } from "@/components/dashboard/DailyBrief";
import { NeedsAttention } from "@/components/dashboard/NeedsAttention";
import {
  dashboardKpis,
  getTherapyMap,
  listAppointmentsForDate,
  recentActivity,
  revenueByDay,
} from "@/lib/queries";
import { getGymDashboard, getNeedsAttention } from "@/lib/dashboard";
import { db, schema } from "@/lib/db";
import { inArray } from "drizzle-orm";
import { formatEur, formatTime, relativeTime } from "@/lib/utils";
import { getSchedulingMode, getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";
import { isBriefComplete } from "@/lib/businessProfile";
import { getCurrentTenant } from "@/lib/db/tenant";
import { AssistantChat } from "@/components/messaging/AssistantChat";

export const dynamic = "force-dynamic";

const KPI_GRID = "repeat(auto-fit, minmax(150px, 1fr))";

export default async function DashboardPage() {
  const vocab = getVocab(getVenueType());
  const tenantId = getCurrentTenant().id;
  const isGym = getSchedulingMode() === "timetable";
  const briefComplete = isBriefComplete();
  const today = new Date().toISOString().slice(0, 10);

  const [kpis, todays, activity, revenue, therapyMap] = await Promise.all([
    dashboardKpis(),
    listAppointmentsForDate(today),
    recentActivity(10),
    revenueByDay(30),
    getTherapyMap(),
  ]);
  const attention = getNeedsAttention();
  const gym = isGym ? getGymDashboard() : null;

  const clientIds = [...new Set(todays.map((a) => a.clientId))];
  const clients = clientIds.length
    ? new Map(
        db.select().from(schema.clients).where(inArray(schema.clients.id, clientIds)).all().map((c) => [c.id, c]),
      )
    : new Map();

  const noRevenue = revenue.every((d) => d.total === 0);

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Today"
        title="Dashboard"
        subtitle={new Date().toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        actions={
          isGym ? (
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
          )
        }
      />

      {/* AI daily brief (auto) + the Orchestrator (single front door: it routes
          to the right specialist, or to the general Concierge toolkit). */}
      <DailyBrief tenantId={tenantId} />
      <div style={{ marginBottom: 20 }}>
        <AssistantChat
          tenantId={tenantId}
          endpoint="/api/agents/orchestrator/chat"
          title="Orchestrator"
          subtitle="routes any request to the right agent — sales, marketing, ops, or your general concierge"
          emptyTitle="Ask for anything — I'll route it"
          emptyBody="Tell me what you need and I'll hand it to the right agent: chasing leads, drafting content, recovering no-shows, or the general stuff — your inbox, invoices, money, and plans. Nothing sends or changes without your approval."
          suggestions={[
            "Give me a breakdown of everything important today",
            "Work my leads and win back anyone who's gone quiet",
            "Pull together this month's invoices",
            "Draft a blog about our newest class",
          ]}
          placeholder="Ask the Orchestrator…  (Enter to send)"
          height="clamp(360px, 44vh, 560px)"
        />
      </div>

      {!briefComplete && (
        <Reveal>
          <Link href="/settings/business">
            <Card style={{ marginBottom: 16, borderColor: "var(--accent)", display: "flex", alignItems: "center", gap: 14, padding: 18 }}>
              <Sparkles size={20} color="var(--accent)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "var(--text-primary)", fontWeight: 500, fontSize: 15 }}>Complete your business brief</div>
                <div style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 2 }}>
                  Add your overview, policies, and FAQs so the AI can triage and reply accurately.
                </div>
              </div>
              <ChevronRight size={18} color="var(--text-tertiary)" />
            </Card>
          </Link>
        </Reveal>
      )}

      <Reveal>
        <NeedsAttention items={attention} />
      </Reveal>

      {isGym && gym ? (
        <>
          {/* ── Gym KPIs ── */}
          <RevealGroup className="modular-grid" style={{ gridTemplateColumns: KPI_GRID, marginBottom: 16 }}>
            <Reveal key="active-members" className="cell" style={{ padding: "22px 22px 24px" }}>
              <Kpi label="Active members" value={String(gym.activeMembers)} sub="on active memberships" />
            </Reveal>
            <Reveal key="mrr" className="cell" style={{ padding: "22px 22px 24px" }}>
              <Kpi label="Monthly recurring" value={formatEur(gym.mrrCents / 100)} sub="from active memberships" />
            </Reveal>
            <Reveal key="classes-this-week" className="cell" style={{ padding: "22px 22px 24px" }}>
              <Kpi label="Classes this week" value={String(gym.classesThisWeek)} sub="scheduled" />
            </Reveal>
            <Reveal key="attendance" className="cell" style={{ padding: "22px 22px 24px" }}>
              <Kpi label="Attendance" value={gym.attendanceRatePct === null ? "—" : `${gym.attendanceRatePct}%`} sub="last 30 days" />
            </Reveal>
            <Reveal key="new-leads" className="cell" style={{ padding: "22px 22px 24px" }}>
              <Kpi label="New leads" value={String(gym.newLeadsThisMonth)} sub="this month" accent={gym.newLeadsThisMonth > 0} />
            </Reveal>
            <Reveal key="revenue" className="cell" style={{ padding: "22px 22px 24px" }}>
              <Kpi label="Revenue" value={formatEur(gym.revenueThisMonthEur)} sub="this month" />
            </Reveal>
          </RevealGroup>

          <Reveal>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20, marginBottom: 32 }} className="dash-split">
              <Card>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <CardLabel style={{ marginBottom: 0 }}>Today&rsquo;s classes</CardLabel>
                  <Link href="/timetable"><Button variant="ghost" size="sm">Timetable</Button></Link>
                </div>
                {gym.todayClasses.length === 0 ? (
                  <div style={{ padding: "24px 0", color: "var(--text-tertiary)", fontSize: 14 }}>No classes scheduled today.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {gym.todayClasses.map((c) => {
                      const full = c.booked >= c.capacity;
                      const pct = c.capacity > 0 ? Math.min(100, Math.round((c.booked / c.capacity) * 100)) : 0;
                      return (
                        <Link key={c.id} href="/timetable" style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", borderRadius: "var(--radius)", border: "1px solid var(--hairline)" }}>
                          <div style={{ fontFamily: "var(--font-heading)", fontSize: 16, color: "var(--text-primary)", minWidth: 62 }}>{formatTime(c.time)}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 500 }}>{c.name}</div>
                            <div style={{ marginTop: 6, height: 5, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}>
                              <div style={{ width: `${pct}%`, height: "100%", background: full ? "#22c55e" : "var(--accent)" }} />
                            </div>
                            {c.instructor && <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 4 }}>{c.instructor}</div>}
                          </div>
                          <div style={{ fontSize: 13, color: full ? "#22c55e" : "var(--text-secondary)", fontWeight: 600, whiteSpace: "nowrap" }}>
                            {c.booked}/{c.capacity}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </Card>

              <RecentActivity activity={activity} />
            </div>
          </Reveal>
        </>
      ) : (
        <>
          {/* ── Clinic KPIs ── */}
          <RevealGroup className="modular-grid" style={{ gridTemplateColumns: KPI_GRID, marginBottom: 16 }}>
            <Reveal key="todays-bookings" className="cell" style={{ padding: "22px 22px 24px" }}>
              <Kpi label={`Today's ${vocab.bookings.toLowerCase()}`} value={String(kpis.todaysCount)} sub={`${kpis.confirmed} confirmed · ${kpis.pending} pending`} />
            </Reveal>
            <Reveal key="active-clients" className="cell" style={{ padding: "22px 22px 24px" }}>
              <Kpi label={`Active ${vocab.members.toLowerCase()}`} value={String(kpis.activeClients)} sub="visited in last 90 days" />
            </Reveal>
            <Reveal key="plans-expiring" className="cell" style={{ padding: "22px 22px 24px" }}>
              <Kpi label={`${vocab.plans} expiring`} value={String(kpis.expiringSoon)} sub="in next 30 days" accent={kpis.expiringSoon > 0} />
            </Reveal>
          </RevealGroup>
          <RevealGroup className="modular-grid" style={{ gridTemplateColumns: KPI_GRID, marginBottom: 32 }}>
            <Reveal key="todays-earnings" className="cell" style={{ padding: "22px 22px 24px" }}>
              <Kpi label="Today's earnings" value={formatEur(kpis.todaysEarnings)} sub="From sessions completed today" />
            </Reveal>
            <Reveal key="cash-today" className="cell" style={{ padding: "22px 22px 24px" }}>
              <Kpi label="Cash today" value={formatEur(kpis.todaysCash)} sub="Payments recorded today (till)" />
            </Reveal>
            <Reveal key="deferred-revenue" className="cell" style={{ padding: "22px 22px 24px" }}>
              <Kpi label="Deferred revenue" value={formatEur(kpis.deferredRevenue)} sub="Unused package credits + open vouchers" />
            </Reveal>
          </RevealGroup>

          <Reveal>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20, marginBottom: 32 }} className="dash-split">
              <Card>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <CardLabel style={{ marginBottom: 0 }}>Today&rsquo;s schedule</CardLabel>
                  <Link href="/appointments/new"><Button variant="ghost" size="sm">Book</Button></Link>
                </div>
                {todays.length === 0 ? (
                  <div style={{ padding: "24px 0", color: "var(--text-tertiary)", fontSize: 14 }}>No {vocab.bookings.toLowerCase()} today.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {todays.map((a) => {
                      const client = clients.get(a.clientId);
                      const therapyIds: number[] = JSON.parse(a.therapyIds || "[]");
                      const ts = therapyIds.map((id) => therapyMap.get(id)).filter(Boolean) as Array<{ id: number; name: string; colourHex: string }>;
                      return (
                        <Link key={a.id} href={`/appointments/${a.id}`} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", borderRadius: "var(--radius)", border: "1px solid var(--hairline)" }}>
                          <div style={{ fontFamily: "var(--font-heading)", fontSize: 16, color: "var(--text-primary)", minWidth: 70 }}>{formatTime(a.startTime)}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 500 }}>{client ? `${client.firstName} ${client.lastName}` : "—"}</div>
                            <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                              {ts.map((t) => (<Badge key={t.id} colour={t.colourHex}>{t.name}</Badge>))}
                            </div>
                          </div>
                          <StatusBadge status={a.status} />
                        </Link>
                      );
                    })}
                  </div>
                )}
              </Card>

              <RecentActivity activity={activity} />
            </div>
          </Reveal>
        </>
      )}

      <Reveal>
        <Card className="brackets" style={{ position: "relative" }}>
          <span className="bk bk-tl" /><span className="bk bk-tr" /><span className="bk bk-bl" /><span className="bk bk-br" />
          <CardLabel>Revenue · last 30 days</CardLabel>
          {noRevenue ? (
            <div style={{ padding: 32, color: "var(--text-tertiary)", fontSize: 14, textAlign: "center" }}>No revenue recorded yet.</div>
          ) : (
            <RevenueBars data={revenue} />
          )}
        </Card>
      </Reveal>
    </div>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  // The "cell" className + padding now live on the <Reveal> wrapping each call
  // site (so it stays the direct child of the `.modular-grid` CSS grid).
  return (
    <>
      <CardLabel>{label}</CardLabel>
      <CardValue style={{ color: accent ? "var(--accent)" : undefined }}>{value}</CardValue>
      <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 10 }}>{sub}</div>
    </>
  );
}

function RecentActivity({ activity }: { activity: { id: number | string; message: string; createdAt: Date | number }[] }) {
  return (
    <Card>
      <CardLabel>Recent activity</CardLabel>
      {activity.length === 0 ? (
        <div style={{ color: "var(--text-tertiary)", fontSize: 14 }}>No activity yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {activity.map((a) => (
            <div key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>{a.message}</div>
              <div style={{ color: "var(--text-tertiary)", fontSize: 11, whiteSpace: "nowrap" }}>{relativeTime(a.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
