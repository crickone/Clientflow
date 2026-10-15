import Link from "next/link";
import { CalendarRange, ChevronRight, ClipboardCheck, CreditCard, Dumbbell, Play, Salad, ScanLine, Target, TrendingUp, Trophy } from "lucide-react";
import { memberCheckin } from "@/lib/checkins";
import { WEEKDAYS } from "@/lib/memberChoicesModel";

import { requireClientPage } from "@/lib/clientAuth";
import { clientDashboard, clientUpcoming } from "@/lib/clientApp";
import { Card, dayLabel, euros, SectionTitle } from "@/components/clientapp/ui";
import { dailyTarget, mealsForDay } from "@/lib/meals";
import { goalTarget } from "@/lib/goals";
import { GOAL_BY_KEY } from "@/lib/goalsModel";
import { dayTotals, kcal } from "@/lib/mealsModel";
import { bodyScansEnabled, getScanProfile, listClientScans } from "@/lib/inbody/scans";
import { formatMetric } from "@/lib/inbody/metrics";
import { formatChange } from "@/lib/inbody/metrics";
import { trainingOverview } from "@/lib/trainingOverview";
import { dateKey, signed } from "@/lib/trainingProgress";
import { formatSet } from "@/lib/workoutLogModel";
import { WeekStrip } from "@/components/clientapp/WeekStrip";
import { StartWorkoutButton } from "@/components/clientapp/StartWorkoutButton";

export const dynamic = "force-dynamic";

export default async function ClientHome() {
  const { clientId, client, tenantId } = requireClientPage();
  const scansOn = bodyScansEnabled(tenantId);
  const scanConsent = scansOn ? getScanProfile(clientId).consentAt !== null : false;
  const scans = scanConsent ? listClientScans(clientId).filter((s) => Object.keys(s.metrics).length > 0) : [];
  const latestScan = scans[0];
  const firstScan = scans[scans.length - 1];
  const d = clientDashboard(clientId);
  const upcoming = clientUpcoming(clientId, 3);
  const t = trainingOverview(clientId);
  const today = dateKey(Date.now());
  const mealsToday = dayTotals(mealsForDay(clientId, today));
  const mealTarget = dailyTarget(clientId);
  const goal = goalTarget(clientId);
  const checkin = memberCheckin(clientId);
  const showTraining = t.programs.length > 0 || t.totalWorkouts > 0;
  const strengthNow = t.strength.length && t.lifts.some((l) => l.sessions > 1) ? t.strength[t.strength.length - 1].value : null;
  const muscle = latestScan && firstScan && latestScan !== firstScan ? formatChange("smm", latestScan.metrics.smm, firstScan.metrics.smm) : null;
  const fat = latestScan && firstScan && latestScan !== firstScan ? formatChange("pbf", latestScan.metrics.pbf, firstScan.metrics.pbf) : null;
  const showProgress = strengthNow !== null || muscle !== null || fat !== null;
  const pct = d.weekBooked > 0 ? Math.round((d.weekAttended / d.weekBooked) * 100) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Welcome back</div>
        <h1 style={{ margin: 0, fontFamily: "var(--font-heading), sans-serif", fontSize: 26, textTransform: "uppercase", color: "var(--text-primary)" }}>
          {client.firstName}
        </h1>
      </div>

      {t.open && (
        <Link href={`/app/workouts/log/${t.open.id}`}>
          <Card style={{ borderColor: "var(--accent)", background: "var(--accent-soft)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ ...iconBox, background: "var(--accent)", color: "#fff" }}><Play size={17} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Continue {t.open.dayName}</div>
                <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{t.open.done} of {t.open.total} sets done</div>
              </div>
              <ChevronRight size={18} style={{ color: "var(--text-tertiary)" }} />
            </div>
          </Card>
        </Link>
      )}

      {/* weekly check-in */}
      {checkin && (
        <Link href="/app/checkin">
          <Card style={checkin.due ? { borderColor: "var(--accent)", background: "var(--accent-soft)" } : undefined}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={checkin.due ? { ...iconBox, background: "var(--accent)", color: "var(--accent-contrast)" } : iconBox}>
                <ClipboardCheck size={18} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{checkin.due ? "Check-in due" : "Check-in done"}</div>
                <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                  {checkin.due
                    ? checkin.daysLate === 0
                      ? "Due today. Takes a couple of minutes."
                      : `Due since ${WEEKDAYS[checkin.weekday - 1]}`
                    : `Next one ${new Date(`${checkin.next}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" })}`}
                </div>
              </div>
              <ChevronRight size={18} style={{ color: "var(--text-tertiary)" }} />
            </div>
          </Card>
        </Link>
      )}

      {/* training */}
      {showTraining && (
        <Card style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Training this week</span>
            <Link href="/app/workouts" style={{ fontSize: 13, color: "var(--accent-ink)" }}>
              Workouts
            </Link>
          </div>
          {t.plan && <WeekStrip days={t.plan.days} todayKey={today} />}
          {t.plan && t.plan.weekdays.length === 0 && (
            <Link href="/app/workouts/plan" style={{ fontSize: 13, color: "var(--accent-ink)", marginTop: -4 }}>
              Pick your training days to plan your week
            </Link>
          )}
          {!t.open && t.next && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, borderTop: "1px solid var(--hairline)", paddingTop: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Next up</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.next.dayName}</div>
              </div>
              <div style={{ width: 112, flexShrink: 0 }}>
                <StartWorkoutButton programId={t.next.programId} dayPosition={t.next.dayPosition} label="Start" size="sm" />
              </div>
            </div>
          )}
          {t.last && (
            <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
              Last workout: {t.last.dayName}, {new Date(t.last.finishedAt).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" })}, {t.last.sets} sets
            </div>
          )}
          {t.latestBest && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text-secondary)" }}>
              <Trophy size={14} style={{ color: "var(--accent-ink)", flexShrink: 0 }} />
              Latest best: {t.latestBest.name} {formatSet(t.latestBest)}
            </div>
          )}
        </Card>
      )}

      {/* progress */}
      {showProgress && (
        <Link href="/app/progress">
          <Card style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <TrendingUp size={16} style={{ color: "var(--accent-ink)" }} />
              <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Your progress</span>
              <ChevronRight size={18} style={{ color: "var(--text-tertiary)" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              <MiniStat label="Strength" value={strengthNow !== null ? signed(strengthNow, "%") : "-"} good={strengthNow !== null && strengthNow > 0} />
              <MiniStat label="Muscle" value={muscle?.text ?? "-"} good={muscle?.tone === "good"} />
              <MiniStat label="Body fat" value={fat?.text ?? "-"} good={fat?.tone === "good"} />
            </div>
          </Card>
        </Link>
      )}

      {/* meals */}
      <Link href="/app/nutrition">
        <Card style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 38, height: 38, borderRadius: 10, background: "var(--surface-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--accent-ink)", flexShrink: 0 }}>
            <Salad size={18} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
              {mealsToday.calories > 0 ? `${kcal(mealsToday.calories)} today` : "Log a meal"}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>
              {mealsToday.calories > 0
                ? mealTarget
                  ? `of ${kcal(mealTarget.calories)} · ${mealsToday.protein} g protein`
                  : `${mealsToday.protein} g protein`
                : "Snap a photo of your meal or the label"}
            </div>
          </div>
          <ChevronRight size={18} style={{ color: "var(--text-tertiary)" }} />
        </Card>
      </Link>

      {/* week progress */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Ring pct={pct} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>This week</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>
              {d.weekAttended} of {d.weekBooked} booked class{d.weekBooked === 1 ? "" : "es"} attended
            </div>
            <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 4 }}>
              {d.upcomingCount} upcoming · {d.totalAttended} attended all-time
            </div>
          </div>
        </div>
      </Card>

      {/* next class */}
      <div>
        <SectionTitle>Next class</SectionTitle>
        {d.nextClass ? (
          <Card style={{ borderLeft: `4px solid ${d.nextClass.color}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{d.nextClass.name}</div>
                <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2 }}>
                  {dayLabel(d.nextClass.date)} · {d.nextClass.startTime}–{d.nextClass.endTime}
                </div>
                {d.nextClass.instructor && <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>with {d.nextClass.instructor}</div>}
              </div>
            </div>
          </Card>
        ) : (
          <Card>
            <div style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>No upcoming classes booked.</div>
            <Link href="/app/timetable" style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 8, color: "var(--accent-ink)", fontSize: 13.5 }}>
              Browse the timetable <ChevronRight size={15} />
            </Link>
          </Card>
        )}
      </div>

      {/* membership */}
      <Link href="/app/membership">
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={iconBox}><CreditCard size={18} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
                {d.membership ? d.membership.name : "No active membership"}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                {d.membership ? `${euros(d.membership.priceCents)} · ${d.membership.status}` : "Ask your coach to set one up"}
              </div>
            </div>
            <ChevronRight size={18} style={{ color: "var(--text-tertiary)" }} />
          </div>
        </Card>
      </Link>

      {/* goal */}
      <Link href="/app/goal">
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={iconBox}><Target size={18} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{goal ? `Goal: ${GOAL_BY_KEY[goal.goal.goal].label}` : "Set a goal"}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                {goal ? `${goal.target.calories.toLocaleString("en-IE")} kcal a day, ${goal.target.protein} g protein` : "Drop body fat, maintain or build muscle: your calories and macros"}
              </div>
            </div>
            <ChevronRight size={18} style={{ color: "var(--text-tertiary)" }} />
          </div>
        </Card>
      </Link>

      {/* body scans */}
      {scansOn && (
        <Link href="/app/body">
          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={iconBox}><ScanLine size={18} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Body scans</div>
                <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                  {latestScan
                    ? `${formatMetric("weight", latestScan.metrics.weight)} · ${formatMetric("smm", latestScan.metrics.smm)} muscle · ${formatMetric("pbf", latestScan.metrics.pbf)} body fat`
                    : scanConsent
                      ? "Your InBody results will show here"
                      : "See your InBody results here"}
                </div>
              </div>
              <ChevronRight size={18} style={{ color: "var(--text-tertiary)" }} />
            </div>
          </Card>
        </Link>
      )}

      {/* upcoming list */}
      {upcoming.length > 0 && (
        <div>
          <SectionTitle>Your upcoming classes</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {upcoming.map((b) => (
              <Card key={b.bookingId} style={{ padding: "12px 14px", borderLeft: `4px solid ${b.color}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{b.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{dayLabel(b.date)} · {b.startTime}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* quick tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
        <Tile href="/app/timetable" icon={<CalendarRange size={20} />} label="Book a class" />
        <Tile href="/app/nutrition" icon={<Salad size={20} />} label="My nutrition" />
        <Tile href="/app/workouts" icon={<Dumbbell size={20} />} label="My workouts" />
        <Tile href="/app/membership" icon={<CreditCard size={20} />} label="Membership" />
      </div>
    </div>
  );
}

function MiniStat({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <span style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 600, color: good ? "var(--success)" : "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

function Ring({ pct }: { pct: number }) {
  const size = 62;
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (pct / 100) * c;
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={off}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="52%" dominantBaseline="middle" textAnchor="middle" fontSize="14" fontWeight="600" fill="var(--text-primary)">
        {pct}%
      </text>
    </svg>
  );
}

function Tile({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href}>
      <Card style={{ display: "flex", flexDirection: "column", gap: 8, padding: 14 }}>
        <span style={{ color: "var(--accent-ink)" }}>{icon}</span>
        <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-primary)" }}>{label}</span>
      </Card>
    </Link>
  );
}

const iconBox: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 10,
  background: "var(--surface-2)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--accent-ink)",
  flexShrink: 0,
};
