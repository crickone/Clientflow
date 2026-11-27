import Link from "next/link";
import { CalendarClock, CalendarPlus, CalendarRange, UsersRound } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
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
import { weekUnfilled } from "@/lib/scheduling/rotaRepo";
import { RotaUnfilledBanner } from "@/components/appointments/rota/RotaUnfilledBanner";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ view?: string; week?: string }>;
}

export default async function AppointmentsPage(props: Props) {
  const searchParams = await props.searchParams;
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
          <>
            <Link href={`/appointments/rota?week=${isoStart}`}>
              <Button variant="ghost">
                <UsersRound size={15} /> Rota
              </Button>
            </Link>
            <Link href="/calendar">
              <Button variant="ghost">
                <CalendarClock size={15} /> Diary
              </Button>
            </Link>
            <Link href="/appointments/new">
              <Button>
                <CalendarPlus size={15} />
                {vocab.bookVerb}
              </Button>
            </Link>
          </>
        }
      />

      {weekUnfilled(isoStart) && <RotaUnfilledBanner week={isoStart} />}

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
        <div className="dt-wrap">
          <table className="dt">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>{vocab.member}</th>
                <th>{vocab.services}</th>
                <th className="dt-num">Price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((a) => {
                const tids: number[] = JSON.parse(a.therapyIds || "[]");
                const client = clients.get(a.clientId);
                return (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/appointments/${a.id}`}>
                        {formatDate(a.date)}
                      </Link>
                    </td>
                    <td>
                      {formatTime(a.startTime)}–{formatTime(a.endTime)}
                    </td>
                    <td>
                      {client ? (
                        <Link href={`/clients/${client.id}`}>
                          {client.firstName} {client.lastName}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
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
                    <td className="dt-num">€{a.totalPriceEur.toFixed(2)}</td>
                    <td>
                      <StatusBadge status={a.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function isoOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
