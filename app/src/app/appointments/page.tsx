import Link from "next/link";
import { CalendarPlus, CalendarRange } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ViewToggle } from "@/components/appointments/ViewToggle";
import { WeekNav } from "@/components/appointments/WeekNav";
import { WeekCalendar } from "@/components/appointments/WeekCalendar";
import {
  getTherapyMap,
  listAppointmentsBetween,
} from "@/lib/queries";
import { db, schema } from "@/lib/db";
import { eq, inArray } from "drizzle-orm";
import { addDays, formatDate, formatTime, startOfWeek } from "@/lib/utils";
import { getSettings, getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";
import { listBlockOuts, weekWindow } from "@/lib/schedule";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: { view?: string; week?: string };
}

export default async function AppointmentsPage({ searchParams }: Props) {
  const vocab = getVocab(getVenueType());
  const view = searchParams.view === "list" ? "list" : "week";
  const weekStart = searchParams.week
    ? startOfWeek(new Date(searchParams.week))
    : startOfWeek(new Date());
  const weekEnd = addDays(weekStart, 5);
  const isoStart = isoOf(weekStart);
  const isoEnd = isoOf(weekEnd);

  const appointments = await listAppointmentsBetween(isoStart, isoEnd);
  const therapyMap = await getTherapyMap();
  const clientIds = [...new Set(appointments.map((a) => a.clientId))];
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
        eyebrow="Schedule"
        title={vocab.bookings}
        actions={
          <Link href="/appointments/new">
            <Button>
              <CalendarPlus size={15} />
              {vocab.bookVerb}
            </Button>
          </Link>
        }
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <WeekNav weekStart={weekStart} />
        <div style={{ marginLeft: "auto" }}>
          <ViewToggle />
        </div>
      </div>

      {view === "week" ? (
        (() => {
          const settings = getSettings();
          const window = weekWindow();
          const blocks = listBlockOuts();
          const therapyList = db
            .select()
            .from(schema.therapies)
            .where(eq(schema.therapies.isActive, true))
            .orderBy(schema.therapies.id)
            .all();
          return (
            <WeekCalendar
              weekStart={weekStart}
              appointments={appointments}
              clients={clients}
              therapies={therapyMap}
              therapyList={therapyList}
              openingHours={settings.openingHours}
              blockOuts={blocks}
              windowOpen={window.open}
              windowClose={window.close}
              slotMinutes={window.slot}
            />
          );
        })()
      ) : appointments.length === 0 ? (
        <EmptyState
          icon={<CalendarRange size={32} strokeWidth={1.4} />}
          title={`No ${vocab.bookings.toLowerCase()} this week`}
          message="Quiet stretch. Book one to fill it."
          action={
            <Link href="/appointments/new">
              <Button>
                <CalendarPlus size={15} />
                {vocab.bookVerb}
              </Button>
            </Link>
          }
        />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table>
            <thead>
              <tr>
                <th style={th}>Date</th>
                <th style={th}>Time</th>
                <th style={th}>{vocab.member}</th>
                <th style={th}>{vocab.services}</th>
                <th style={th}>Price</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((a) => {
                const tids: number[] = JSON.parse(a.therapyIds || "[]");
                const client = clients.get(a.clientId);
                return (
                  <tr key={a.id}>
                    <td style={td}>
                      <Link href={`/appointments/${a.id}`} style={linkS}>
                        {formatDate(a.date)}
                      </Link>
                    </td>
                    <td style={td}>
                      {formatTime(a.startTime)}–{formatTime(a.endTime)}
                    </td>
                    <td style={td}>
                      {client ? (
                        <Link href={`/clients/${client.id}`} style={linkS}>
                          {client.firstName} {client.lastName}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={td}>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {tids.map((tid) => {
                          const t = therapyMap.get(tid);
                          if (!t) return null;
                          return (
                            <Badge key={tid} colour={t.colourHex}>
                              {t.name}
                            </Badge>
                          );
                        })}
                      </div>
                    </td>
                    <td style={td}>€{a.totalPriceEur.toFixed(2)}</td>
                    <td style={td}>
                      <StatusBadge status={a.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function isoOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "14px 16px",
  fontSize: 11,
  fontWeight: 500,
  color: "var(--text-tertiary)",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  borderBottom: "1px solid var(--hairline)",
  background: "transparent",
};
const td: React.CSSProperties = {
  padding: "14px 16px",
  borderBottom: "1px solid var(--hairline)",
  fontSize: 14,
  color: "var(--text-secondary)",
};
const linkS: React.CSSProperties = {
  color: "var(--text-primary)",
  fontWeight: 500,
};
