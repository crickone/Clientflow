import Link from "next/link";
import { notFound } from "next/navigation";
import { Mail, Pencil, Phone } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DeleteClientButton } from "@/components/clients/DeleteClientButton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/Tabs";
import {
  getClient,
  getClientStats,
  getTherapyMap,
  listClientAppointments,
  listClientPackages,
  listClientPayments,
  listClientSessions,
} from "@/lib/queries";
import {
  formatDate,
  formatDateTime,
  formatEur,
  formatTime,
  initialsOf,
} from "@/lib/utils";
import { getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";
import { getClientMessages } from "@/lib/clientMessages";
import { ClientConversation } from "@/components/messaging/ClientConversation";
import {
  assignedNutrition,
  assignedWorkouts,
  availableNutrition,
  availableWorkouts,
  getClientLogin,
} from "@/lib/clientAccess";
import { ClientAppAccess } from "@/components/clients/ClientAppAccess";

export const dynamic = "force-dynamic";

export default async function ClientProfile({
  params,
}: {
  params: { id: string };
}) {
  const vocab = getVocab(getVenueType());
  const id = Number(params.id);
  const client = await getClient(id);
  if (!client) notFound();
  const [stats, appointments, sessions, packages, payments, therapyMap] =
    await Promise.all([
      getClientStats(id),
      listClientAppointments(id),
      listClientSessions(id),
      listClientPackages(id),
      listClientPayments(id),
      getTherapyMap(),
    ]);
  const messages = getClientMessages(id);
  const clientLogin = getClientLogin(id);
  const assignedNut = assignedNutrition(id);
  const availNut = availableNutrition();
  const assignedWk = assignedWorkouts(id);
  const availWk = availableWorkouts();

  return (
    <div className="app-page">
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 24,
          marginBottom: 32,
          flexWrap: "wrap",
        }}
      >
        <Avatar initials={initialsOf(client.firstName, client.lastName)} size={72} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-tertiary)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              marginBottom: 8,
              fontWeight: 500,
            }}
          >
            {vocab.member}
          </div>
          <h1
            style={{
              fontFamily: "var(--font-heading), sans-serif",
              fontSize: "clamp(28px, 3.5vw, 40px)",
              fontWeight: 400,
              textTransform: "uppercase",
              color: "var(--text-primary)",
              lineHeight: 1.05,
            }}
          >
            {client.firstName} {client.lastName}
          </h1>
          <div
            style={{
              display: "flex",
              gap: 16,
              marginTop: 12,
              color: "var(--text-secondary)",
              fontSize: 14,
              flexWrap: "wrap",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Phone size={14} /> {client.phone}
            </span>
            {client.email && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Mail size={14} /> {client.email}
              </span>
            )}
            {client.gdprConsent && (
              <Badge tone="green">GDPR consent</Badge>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <Link href={`/clients/${id}/edit`}>
            <Button variant="outline">
              <Pencil size={14} />
              Edit
            </Button>
          </Link>
          <DeleteClientButton
            clientId={id}
            clientName={`${client.firstName} ${client.lastName}`}
            appointmentCount={appointments.length}
            packageCount={packages.length}
          />
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="appointments">
            {vocab.bookings} ({appointments.length})
          </TabsTrigger>
          <TabsTrigger value="sessions">
            Sessions ({sessions.length})
          </TabsTrigger>
          <TabsTrigger value="packages">
            {vocab.plans} ({packages.length})
          </TabsTrigger>
          <TabsTrigger value="payments">
            Payments ({payments.length})
          </TabsTrigger>
          <TabsTrigger value="messages">
            Messages ({messages.length})
          </TabsTrigger>
          <TabsTrigger value="app">App &amp; Plans</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 16,
              marginBottom: 24,
            }}
          >
            <Stat label="Total sessions" value={String(stats.totalSessions)} />
            <Stat label="Total spend" value={formatEur(stats.totalSpend)} />
            <Stat
              label="First visit"
              value={stats.firstVisit ? formatDate(stats.firstVisit) : "—"}
            />
            <Stat
              label="Last visit"
              value={stats.lastVisit ? formatDate(stats.lastVisit) : "—"}
            />
            <Stat
              label={`Favourite ${vocab.service.toLowerCase()}`}
              value={stats.favouriteTherapy ?? "—"}
            />
          </div>
          {client.medicalNotes && (
            <Card>
              <CardLabel>Medical notes</CardLabel>
              <div style={{ color: "var(--text-secondary)", fontSize: 14, whiteSpace: "pre-wrap" }}>
                {client.medicalNotes}
              </div>
            </Card>
          )}
          {client.address && (
            <Card style={{ marginTop: 16 }}>
              <CardLabel>Address</CardLabel>
              <div style={{ color: "var(--text-secondary)", fontSize: 14, whiteSpace: "pre-wrap" }}>
                {client.address}
              </div>
            </Card>
          )}
          {(client.emergencyContactName || client.emergencyContactPhone) && (
            <Card style={{ marginTop: 16 }}>
              <CardLabel>Emergency contact</CardLabel>
              <div style={{ color: "var(--text-primary)", fontSize: 14 }}>
                {client.emergencyContactName ?? "—"}
              </div>
              <div style={{ color: "var(--text-tertiary)", fontSize: 13, marginTop: 4 }}>
                {client.emergencyContactPhone ?? ""}
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="appointments">
          {appointments.length === 0 ? (
            <Empty message={`No ${vocab.bookings.toLowerCase()} yet.`} />
          ) : (
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <table>
                <thead>
                  <tr>
                    <th style={th}>Date</th>
                    <th style={th}>Time</th>
                    <th style={th}>{vocab.services}</th>
                    <th style={th}>Price</th>
                    <th style={th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {appointments.map((a) => {
                    const tids: number[] = JSON.parse(a.therapyIds || "[]");
                    return (
                      <tr key={a.id}>
                        <td style={td}>
                          <Link href={`/appointments/${a.id}`} style={linkStyle}>
                            {formatDate(a.date)}
                          </Link>
                        </td>
                        <td style={td}>{formatTime(a.startTime)}</td>
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
                        <td style={td}>{formatEur(a.totalPriceEur)}</td>
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
        </TabsContent>

        <TabsContent value="sessions">
          {sessions.length === 0 ? (
            <Empty message="No completed sessions yet." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {sessions.map((s) => {
                const t = therapyMap.get(s.therapyId);
                return (
                  <Card key={s.id}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 8,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {t && <Badge colour={t.colourHex}>{t.name}</Badge>}
                        <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                          {formatDate(s.date)} · {s.durationMinutes}min
                        </span>
                      </div>
                      {s.outcomeRating && (
                        <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>
                          {"★".repeat(s.outcomeRating)}
                          {"☆".repeat(5 - s.outcomeRating)}
                        </span>
                      )}
                    </div>
                    {s.therapistNotes && (
                      <div style={{ color: "var(--text-secondary)", fontSize: 14, whiteSpace: "pre-wrap" }}>
                        {s.therapistNotes}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="packages">
          {packages.length === 0 ? (
            <Empty message={`No ${vocab.plans.toLowerCase()} purchased.`} />
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                gap: 16,
              }}
            >
              {packages.map((p) => {
                const t = therapyMap.get(p.therapyId);
                const pct = Math.min(100, (p.sessionsUsed / p.totalSessions) * 100);
                const expired = p.expiryDate < new Date().toISOString().slice(0, 10);
                return (
                  <Card key={p.id}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: 10,
                      }}
                    >
                      {t && <Badge colour={t.colourHex}>{t.name}</Badge>}
                      {expired ? (
                        <Badge tone="red">Expired</Badge>
                      ) : p.isActive ? (
                        <Badge tone="green">Active</Badge>
                      ) : (
                        <Badge>Inactive</Badge>
                      )}
                    </div>
                    <div style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                      {p.packageName}
                    </div>
                    <div
                      style={{
                        margin: "12px 0",
                        height: 6,
                        background: "var(--surface-2)",
                        borderRadius: "var(--radius)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: "100%",
                          background: t?.colourHex ?? "var(--text-primary)",
                        }}
                      />
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        color: "var(--text-tertiary)",
                        fontSize: 12,
                      }}
                    >
                      <span>
                        {p.sessionsUsed} / {p.totalSessions} used
                      </span>
                      <span>Expires {formatDate(p.expiryDate)}</span>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="payments">
          {payments.length === 0 ? (
            <Empty message="No payments recorded." />
          ) : (
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <table>
                <thead>
                  <tr>
                    <th style={th}>Date</th>
                    <th style={th}>Method</th>
                    <th style={th}>Amount</th>
                    <th style={th}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td style={td}>{formatDateTime(p.createdAt)}</td>
                      <td style={td}>
                        <Badge>{p.paymentMethod}</Badge>
                      </td>
                      <td style={td}>{formatEur(p.amountEur)}</td>
                      <td style={{ ...td, color: "var(--text-tertiary)" }}>
                        {p.notes ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="messages">
          <ClientConversation
            clientId={id}
            hasPhone={Boolean(client.phone)}
            initialMessages={messages.map((m) => ({
              id: m.id,
              direction: m.direction,
              channel: m.channel,
              content: m.content,
              status: m.status,
              aiGenerated: m.aiGenerated,
              sentAt: m.sentAt,
              createdAt: m.createdAt,
            }))}
          />
        </TabsContent>

        <TabsContent value="app">
          <ClientAppAccess
            clientId={id}
            clientEmail={client.email}
            login={clientLogin}
            assignedNutrition={assignedNut}
            availableNutrition={availNut}
            assignedWorkouts={assignedWk}
            availableWorkouts={availWk}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
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
const linkStyle: React.CSSProperties = {
  color: "var(--text-primary)",
  fontWeight: 500,
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardLabel>{label}</CardLabel>
      <div
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 24,
          textTransform: "uppercase",
          color: "var(--text-primary)",
        }}
      >
        {value}
      </div>
    </Card>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: "48px 24px",
        background: "var(--surface-1)",
        border: "1px dashed var(--hairline)",
        borderRadius: "var(--radius)",
        color: "var(--text-tertiary)",
        fontSize: 14,
        textAlign: "center",
      }}
    >
      {message}
    </div>
  );
}
