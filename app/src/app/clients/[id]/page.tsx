import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarPlus, Pencil, Star } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
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
import { ClientEmailPanel } from "@/components/clients/ClientEmailPanel";
import { listClientEmails } from "@/lib/clientEmail";
import { isEmailConfigured } from "@/lib/email";
import { getCurrentMembership } from "@/lib/auth";
import { clientMembership } from "@/lib/clientApp";
import { bodyScansEnabled, getScanProfile, listClientScans } from "@/lib/inbody/scans";
import { goalTarget } from "@/lib/goals";
import { ACTIVITY_BY_KEY, GOAL_BY_KEY } from "@/lib/goalsModel";
import { liftRecords, listSessions, openSession } from "@/lib/workoutLog";
import { ClientWorkoutLog } from "@/components/clients/ClientWorkoutLog";
import { trainingOverview } from "@/lib/trainingOverview";
import { ClientBodyScans } from "@/components/clients/ClientBodyScans";
import { ClientJourney } from "@/components/clients/ClientJourney";
import { getClientJourney } from "@/lib/clientJourney";

export const dynamic = "force-dynamic";

export default async function ClientProfile({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { tab?: string };
}) {
  const vocab = getVocab(getVenueType());
  const id = Number(params.id);
  const client = await getClient(id);
  if (!client) notFound();
  const journey = getClientJourney(client.id);
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
  const clientEmailHistory = listClientEmails(id);
  const emailReady = isEmailConfigured();
  const clientLogin = getClientLogin(id);
  const assignedNut = assignedNutrition(id);
  const availNut = availableNutrition();
  const assignedWk = assignedWorkouts(id);
  const availWk = availableWorkouts();
  const membership = getCurrentMembership();
  const activeMembership = clientMembership(id);
  const showScans = membership ? bodyScansEnabled(membership.tenant.id) : false;
  const scans = showScans ? listClientScans(id) : [];
  const scanProfile = showScans ? getScanProfile(id) : null;
  const clientGoal = showScans ? goalTarget(id) : null;
  const workoutSessions = listSessions(id, 60);
  const openWorkout = openSession(id);
  const showWorkoutLog = assignedWk.length > 0 || workoutSessions.length > 0 || openWorkout !== null;
  const lifts = showWorkoutLog ? liftRecords(id) : [];
  const training = showWorkoutLog ? trainingOverview(id) : null;

  const lastSeen = stats.lastVisit ? formatDate(stats.lastVisit) : null;
  const appState = !clientLogin ? "No app login" : !clientLogin.isActive ? "App disabled" : clientLogin.lastLoginAt ? `In the app ${relativeDay(clientLogin.lastLoginAt)}` : "Never opened the app";
  const appTone = clientLogin?.isActive && clientLogin.lastLoginAt ? "green" : "neutral";
  const defaultTab = searchParams?.tab && TAB_KEYS.has(searchParams.tab) ? searchParams.tab : "journey";

  return (
    <div className="app-page cp">
      <Link href="/clients" className="cp-back">
        <ArrowLeft size={14} /> {vocab.members}
      </Link>

      <header className="cp-head">
        <div className="cp-who">
          <span className="cp-avatar" aria-hidden>
            {initialsOf(client.firstName, client.lastName)}
          </span>
          <div className="cp-who-text">
            <h1 className="cp-name">
              {client.firstName} {client.lastName}
            </h1>
            <p className="cp-origin">
              {vocab.member}
              {stats.firstVisit ? ` since ${formatDate(stats.firstVisit)}` : ""}
              {lastSeen ? ` · last in ${lastSeen}` : " · not in yet"}
            </p>
            <div className="cp-chips">
              <Badge tone={activeMembership ? "green" : "neutral"}>{activeMembership ? activeMembership.name : "No membership"}</Badge>
              <Badge tone={appTone}>{appState}</Badge>
              {clientGoal && <Badge tone="neutral">Goal: {GOAL_BY_KEY[clientGoal.goal.goal].label}</Badge>}
            </div>
          </div>
        </div>
        <div className="cp-actions">
          <Link href={`/appointments/new?client=${id}`}>
            <Button>
              <CalendarPlus size={14} />
              Book
            </Button>
          </Link>
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
      </header>

      <div className="cp-grid">
      <Tabs defaultValue={defaultTab} className="cp-main">
        <TabsList>
          <TabsTrigger value="journey">Journey</TabsTrigger>
          <TabsTrigger value="appointments">
            {vocab.bookings} <Count n={appointments.length} />
          </TabsTrigger>
          <TabsTrigger value="sessions">
            Sessions <Count n={sessions.length} />
          </TabsTrigger>
          <TabsTrigger value="packages">
            {vocab.plans} <Count n={packages.length} />
          </TabsTrigger>
          <TabsTrigger value="payments">
            Payments <Count n={payments.length} />
          </TabsTrigger>
          <TabsTrigger value="messages">
            Messages <Count n={messages.length} />
          </TabsTrigger>
          <TabsTrigger value="email">
            Email <Count n={clientEmailHistory.length} />
          </TabsTrigger>
          <TabsTrigger value="app">Client app</TabsTrigger>
          {showWorkoutLog && <TabsTrigger value="workouts">Workout log <Count n={workoutSessions.length} /></TabsTrigger>}
          {showScans && <TabsTrigger value="scans">Body scans <Count n={scans.length} /></TabsTrigger>}
        </TabsList>

        {showWorkoutLog && training && (
          <TabsContent value="workouts">
            <ClientWorkoutLog sessions={workoutSessions} records={lifts} open={openWorkout} overview={training} />
          </TabsContent>
        )}

        {showScans && scanProfile && (
          <TabsContent value="scans">
            <ClientBodyScans
              clientId={id}
              scans={scans}
              inbodyUserId={scanProfile.inbodyUserId}
              consentAt={scanProfile.consentAt}
              isAdmin={membership?.role === "admin"}
              goal={
                clientGoal
                  ? {
                      label: GOAL_BY_KEY[clientGoal.goal.goal].label,
                      activity: `${ACTIVITY_BY_KEY[clientGoal.goal.activity].label} ${ACTIVITY_BY_KEY[clientGoal.goal.activity].sub}`,
                      calories: clientGoal.target.calories,
                      protein: clientGoal.target.protein,
                      carbs: clientGoal.target.carbs,
                      fat: clientGoal.target.fat,
                      setAt: clientGoal.goal.setAt,
                    }
                  : null
              }
            />
          </TabsContent>
        )}

        <TabsContent value="journey">
          <ClientJourney events={journey} />
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
                const outcomeRating = s.outcomeRating ?? 0;
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
                      {outcomeRating > 0 && (
                        <span
                          style={{ display: "flex", alignItems: "center", gap: 1, color: "var(--text-tertiary)" }}
                          aria-label={`${outcomeRating} out of 5`}
                        >
                          {Array.from({ length: 5 }, (_, i) => (
                            <Star key={i} size={12} fill={i < outcomeRating ? "currentColor" : "none"} />
                          ))}
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

        <TabsContent value="email">
          <ClientEmailPanel
            clientId={id}
            clientEmail={client.email}
            emailReady={emailReady}
            history={clientEmailHistory}
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

      <aside className="cp-side">
        <Card className="cp-card">
          <CardLabel>Details</CardLabel>
          <dl className="cp-facts">
            <div>
              <dt>Phone</dt>
              <dd><a href={`tel:${client.phone.replace(/[^\d+]/g, "")}`}>{client.phone}</a></dd>
            </div>
            {client.email && (
              <div>
                <dt>Email</dt>
                <dd><a href={`mailto:${client.email}`}>{client.email}</a></dd>
              </div>
            )}
            {client.dateOfBirth && (
              <div>
                <dt>Born</dt>
                <dd>{formatDate(client.dateOfBirth)}</dd>
              </div>
            )}
            {client.address && (
              <div>
                <dt>Address</dt>
                <dd>{client.address}</dd>
              </div>
            )}
            <div>
              <dt>GDPR consent</dt>
              <dd>{client.gdprConsent ? "Given" : "Not given"}</dd>
            </div>
          </dl>
        </Card>

        <Card className="cp-card">
          <CardLabel>With us</CardLabel>
          <dl className="cp-facts">
            <div>
              <dt>Sessions</dt>
              <dd>{stats.totalSessions}</dd>
            </div>
            <div>
              <dt>Spent</dt>
              <dd>{formatEur(stats.totalSpend)}</dd>
            </div>
            <div>
              <dt>First visit</dt>
              <dd>{stats.firstVisit ? formatDate(stats.firstVisit) : "Not yet"}</dd>
            </div>
            <div>
              <dt>Last visit</dt>
              <dd>{lastSeen ?? "Not yet"}</dd>
            </div>
            {stats.favouriteTherapy && (
              <div>
                <dt>Favourite {vocab.service.toLowerCase()}</dt>
                <dd>{stats.favouriteTherapy}</dd>
              </div>
            )}
            <div>
              <dt>Membership</dt>
              <dd>{activeMembership ? `${activeMembership.name}, ${formatEur(activeMembership.priceCents)}` : "None"}</dd>
            </div>
            {clientGoal && (
              <div>
                <dt>Goal in the app</dt>
                <dd>{GOAL_BY_KEY[clientGoal.goal.goal].label}, {clientGoal.target.calories.toLocaleString("en-IE")} kcal</dd>
              </div>
            )}
          </dl>
        </Card>

        {(client.medicalNotes || client.emergencyContactName || client.emergencyContactPhone) && (
          <Card className="cp-card">
            <CardLabel>Care</CardLabel>
            {client.medicalNotes && (
              <p className="cp-notes">{client.medicalNotes}</p>
            )}
            {(client.emergencyContactName || client.emergencyContactPhone) && (
              <dl className="cp-facts">
                <div>
                  <dt>Emergency contact</dt>
                  <dd>
                    {client.emergencyContactName ?? ""}
                    {client.emergencyContactPhone ? (client.emergencyContactName ? ", " : "") + client.emergencyContactPhone : ""}
                  </dd>
                </div>
              </dl>
            )}
          </Card>
        )}
      </aside>
      </div>
    </div>
  );
}

const TAB_KEYS = new Set(["journey", "appointments", "sessions", "packages", "payments", "messages", "email", "app", "workouts", "scans"]);

/** A count beside a tab name, only when there is something to count. */
function Count({ n }: { n: number }) {
  return n > 0 ? <span className="tab-count">{n}</span> : null;
}

function relativeDay(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return formatDate(new Date(ms).toISOString().slice(0, 10));
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
