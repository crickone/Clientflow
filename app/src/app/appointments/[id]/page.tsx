import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Calendar, Clock, Receipt, User } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { StatusActions } from "@/components/appointments/StatusActions";
import {
  getAppointment,
  getTherapyMap,
  listPackagesForClient,
} from "@/lib/queries";
import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { formatDate, formatEur, formatTime } from "@/lib/utils";
import { getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

export default async function AppointmentDetail({
  params,
}: {
  params: { id: string };
}) {
  const vocab = getVocab(getVenueType());
  const id = Number(params.id);
  const appt = await getAppointment(id);
  if (!appt) notFound();

  const client = db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.id, appt.clientId))
    .get();
  const therapyMap = await getTherapyMap();
  const therapyIds: number[] = JSON.parse(appt.therapyIds || "[]");
  const therapies = therapyIds
    .map((id) => therapyMap.get(id))
    .filter(Boolean) as Array<{ id: number; name: string; colourHex: string }>;

  const apptPayments = db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.appointmentId, id))
    .all();

  const today = new Date().toISOString().slice(0, 10);
  const activePackages = (
    await listPackagesForClient(appt.clientId)
  ).filter(
    (p) => p.expiryDate >= today && p.sessionsUsed < p.totalSessions,
  );
  const packageNames = new Map(
    activePackages.map((p) => [
      p.id,
      `${p.packageName} (${p.sessionsUsed}/${p.totalSessions})`,
    ]),
  );

  return (
    <div className="app-page" style={{ maxWidth: 880 }}>
      <Link
        href="/appointments"
        style={{
          display: "inline-flex",
          gap: 6,
          alignItems: "center",
          color: "var(--text-tertiary)",
          fontSize: 13,
          marginBottom: 24,
        }}
      >
        <ArrowLeft size={14} />
        Back to schedule
      </Link>

      <PageHeader
        eyebrow={`${vocab.booking} #${appt.id}`}
        title={`${formatDate(appt.date)}`}
        subtitle={`${formatTime(appt.startTime)} — ${formatTime(appt.endTime)}`}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr",
          gap: 20,
          marginBottom: 24,
        }}
      >
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <StatusBadge status={appt.status} />
            <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>
              Updated {formatDate(appt.updatedAt)}
            </span>
          </div>

          <Row icon={<User size={14} />} label={vocab.member}>
            {client ? (
              <Link
                href={`/clients/${client.id}`}
                style={{ color: "var(--text-primary)", fontWeight: 500 }}
              >
                {client.firstName} {client.lastName}
              </Link>
            ) : (
              "—"
            )}
          </Row>
          <Row icon={<Calendar size={14} />} label="Date">
            {formatDate(appt.date)}
          </Row>
          <Row icon={<Clock size={14} />} label="Time">
            {formatTime(appt.startTime)} – {formatTime(appt.endTime)}
          </Row>
          <Row icon={<Receipt size={14} />} label="Price">
            {formatEur(appt.totalPriceEur)}
          </Row>

          <div style={{ marginTop: 16 }}>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-tertiary)",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginBottom: 8,
                fontWeight: 500,
              }}
            >
              {vocab.services}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {therapies.map((t) => (
                <Badge key={t.id} colour={t.colourHex}>
                  {t.name}
                </Badge>
              ))}
            </div>
          </div>

          {appt.notes && (
            <div style={{ marginTop: 16 }}>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-tertiary)",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  marginBottom: 8,
                  fontWeight: 500,
                }}
              >
                Notes
              </div>
              <div
                style={{
                  color: "var(--text-secondary)",
                  fontSize: 14,
                  whiteSpace: "pre-wrap",
                }}
              >
                {appt.notes}
              </div>
            </div>
          )}
        </Card>

        <Card>
          <CardLabel>Status</CardLabel>
          <StatusActions
            appointmentId={appt.id}
            status={appt.status}
            activePackages={activePackages}
            packageNames={packageNames}
          />
        </Card>
      </div>

      <Card>
        <CardLabel>Payment</CardLabel>
        {apptPayments.length === 0 ? (
          <div style={{ color: "var(--text-tertiary)", fontSize: 14 }}>
            No payments recorded.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={th}>Method</th>
                <th style={th}>Amount</th>
                <th style={th}>Recorded</th>
              </tr>
            </thead>
            <tbody>
              {apptPayments.map((p) => (
                <tr key={p.id}>
                  <td style={td}>
                    <Badge>{p.paymentMethod}</Badge>
                  </td>
                  <td style={td}>{formatEur(p.amountEur)}</td>
                  <td style={td}>{formatDate(p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px 1fr",
        alignItems: "center",
        padding: "10px 0",
        borderBottom: "1px solid var(--hairline)",
        fontSize: 14,
      }}
    >
      <div
        style={{
          color: "var(--text-tertiary)",
          fontSize: 12,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          fontWeight: 500,
          display: "inline-flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        {icon} {label}
      </div>
      <div style={{ color: "var(--text-primary)" }}>{children}</div>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  fontSize: 11,
  fontWeight: 500,
  color: "var(--text-tertiary)",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  borderBottom: "1px solid var(--hairline)",
  background: "transparent",
};
const td: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--hairline)",
  fontSize: 14,
  color: "var(--text-secondary)",
};
