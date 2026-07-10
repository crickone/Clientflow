import Link from "next/link";
import { CalendarPlus, Sparkles, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardLabel, CardValue } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { RevenueBars } from "@/components/charts/RevenueBars";
import {
  dashboardKpis,
  getTherapyMap,
  listAppointmentsForDate,
  recentActivity,
  revenueByDay,
} from "@/lib/queries";
import { db, schema } from "@/lib/db";
import { inArray } from "drizzle-orm";
import { formatEur, formatTime, relativeTime } from "@/lib/utils";
import { getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";
import { isBriefComplete } from "@/lib/businessProfile";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const vocab = getVocab(getVenueType());
  const briefComplete = isBriefComplete();
  const today = new Date().toISOString().slice(0, 10);
  const [kpis, todays, activity, revenue, therapyMap] = await Promise.all([
    dashboardKpis(),
    listAppointmentsForDate(today),
    recentActivity(10),
    revenueByDay(30),
    getTherapyMap(),
  ]);

  const clientIds = [...new Set(todays.map((a) => a.clientId))];
  const clients = clientIds.length
    ? new Map(
        db
          .select()
          .from(schema.clients)
          .where(inArray(schema.clients.id, clientIds))
          .all()
          .map((c) => [c.id, c]),
      )
    : new Map();

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Today"
        title="Dashboard"
        subtitle={new Date().toLocaleDateString("en-IE", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })}
        actions={
          <Link href="/appointments/new">
            <Button>
              <CalendarPlus size={15} />
              {vocab.bookCta}
            </Button>
          </Link>
        }
      />

      {!briefComplete && (
        <Link href="/settings/business">
          <Card
            style={{
              marginBottom: 16,
              borderColor: "var(--accent)",
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: 18,
            }}
          >
            <Sparkles size={20} color="var(--accent)" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  color: "var(--text-primary)",
                  fontWeight: 500,
                  fontSize: 15,
                }}
              >
                Complete your business brief
              </div>
              <div
                style={{
                  color: "var(--text-secondary)",
                  fontSize: 13,
                  marginTop: 2,
                }}
              >
                Add your overview, policies, and FAQs so the AI inbox can triage
                and reply accurately. Auto-reply stays off until this is done.
              </div>
            </div>
            <ChevronRight size={18} color="var(--text-tertiary)" />
          </Card>
        </Link>
      )}

      {/* Operations row */}
      <div
        className="modular-grid"
        style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 16 }}
      >
        <div className="cell" style={{ padding: "22px 22px 24px" }}>
          <CardLabel>Today&rsquo;s {vocab.bookings.toLowerCase()}</CardLabel>
          <CardValue>{kpis.todaysCount}</CardValue>
          <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 10 }}>
            {kpis.confirmed} confirmed · {kpis.pending} pending
          </div>
        </div>
        <div className="cell" style={{ padding: "22px 22px 24px" }}>
          <CardLabel>Active {vocab.members.toLowerCase()}</CardLabel>
          <CardValue>{kpis.activeClients}</CardValue>
          <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 10 }}>
            visited in last 90 days
          </div>
        </div>
        <div className="cell" style={{ padding: "22px 22px 24px" }}>
          <CardLabel>{vocab.plans} expiring</CardLabel>
          <CardValue style={{ color: kpis.expiringSoon > 0 ? "var(--accent)" : undefined }}>
            {kpis.expiringSoon}
          </CardValue>
          <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 10 }}>
            in next 30 days
          </div>
        </div>
      </div>

      {/* Revenue row — three views */}
      <div
        style={{
          fontFamily: "var(--font-mono), ui-monospace, monospace",
          fontSize: 11,
          color: "var(--text-tertiary)",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          margin: "26px 0 10px",
        }}
      >
        // Revenue
      </div>
      <div
        className="modular-grid"
        style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 32 }}
      >
        <div className="cell" style={{ padding: "22px 22px 24px" }}>
          <CardLabel>Today&rsquo;s earnings</CardLabel>
          <CardValue>{formatEur(kpis.todaysEarnings)}</CardValue>
          <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 10 }}>
            From sessions completed today
          </div>
        </div>
        <div className="cell" style={{ padding: "22px 22px 24px" }}>
          <CardLabel>Cash today</CardLabel>
          <CardValue>{formatEur(kpis.todaysCash)}</CardValue>
          <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 10 }}>
            Payments recorded today (till)
          </div>
        </div>
        <div className="cell" style={{ padding: "22px 22px 24px" }}>
          <CardLabel>Deferred revenue</CardLabel>
          <CardValue>{formatEur(kpis.deferredRevenue)}</CardValue>
          <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 10 }}>
            Unused package credits + open vouchers
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr",
          gap: 20,
          marginBottom: 32,
        }}
      >
        <Card>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <CardLabel style={{ marginBottom: 0 }}>Today&rsquo;s schedule</CardLabel>
            <Link href="/appointments/new">
              <Button variant="ghost" size="sm">
                Book
              </Button>
            </Link>
          </div>
          {todays.length === 0 ? (
            <div style={{ padding: "24px 0", color: "var(--text-tertiary)", fontSize: 14 }}>
              No {vocab.bookings.toLowerCase()} today.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {todays.map((a) => {
                const client = clients.get(a.clientId);
                const therapyIds: number[] = JSON.parse(a.therapyIds || "[]");
                const ts = therapyIds
                  .map((id) => therapyMap.get(id))
                  .filter(Boolean) as Array<{ id: number; name: string; colourHex: string }>;
                return (
                  <Link
                    key={a.id}
                    href={`/appointments/${a.id}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      padding: "12px 14px",
                      borderRadius: "var(--radius)",
                      border: "1px solid var(--hairline)",
                      transition: "background 0.15s var(--ease)",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontSize: 16,
                        color: "var(--text-primary)",
                        minWidth: 70,
                      }}
                    >
                      {formatTime(a.startTime)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          color: "var(--text-primary)",
                          fontSize: 14,
                          fontWeight: 500,
                        }}
                      >
                        {client ? `${client.firstName} ${client.lastName}` : "—"}
                      </div>
                      <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                        {ts.map((t) => (
                          <Badge key={t.id} colour={t.colourHex}>
                            {t.name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <StatusBadge status={a.status} />
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <CardLabel>Recent activity</CardLabel>
          {activity.length === 0 ? (
            <div style={{ color: "var(--text-tertiary)", fontSize: 14 }}>
              No activity yet.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {activity.map((a) => (
                <div key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                    {a.message}
                  </div>
                  <div style={{ color: "var(--text-tertiary)", fontSize: 11, whiteSpace: "nowrap" }}>
                    {relativeTime(a.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="brackets" style={{ position: "relative" }}>
        <span className="bk bk-tl" />
        <span className="bk bk-tr" />
        <span className="bk bk-bl" />
        <span className="bk bk-br" />
        <CardLabel>Revenue · last 30 days</CardLabel>
        {revenue.every((d) => d.total === 0) ? (
          <div
            style={{
              padding: 32,
              color: "var(--text-tertiary)",
              fontSize: 14,
              textAlign: "center",
            }}
          >
            No revenue recorded yet.
          </div>
        ) : (
          <RevenueBars data={revenue} />
        )}
      </Card>
    </div>
  );
}
