import Link from "next/link";
import { CalendarRange, ChevronRight, CreditCard, Dumbbell, Salad } from "lucide-react";

import { requireClientPage } from "@/lib/clientAuth";
import { clientDashboard, clientUpcoming } from "@/lib/clientApp";
import { Card, dayLabel, euros, SectionTitle } from "@/components/clientapp/ui";

export const dynamic = "force-dynamic";

export default async function ClientHome() {
  const { clientId, client } = requireClientPage();
  const d = clientDashboard(clientId);
  const upcoming = clientUpcoming(clientId, 3);
  const pct = d.weekBooked > 0 ? Math.round((d.weekAttended / d.weekBooked) * 100) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Welcome back</div>
        <h1 style={{ margin: 0, fontFamily: "var(--font-heading), sans-serif", fontSize: 26, textTransform: "uppercase", color: "var(--text-primary)" }}>
          {client.firstName}
        </h1>
      </div>

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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Tile href="/app/timetable" icon={<CalendarRange size={20} />} label="Book a class" />
        <Tile href="/app/nutrition" icon={<Salad size={20} />} label="My nutrition" />
        <Tile href="/app/workouts" icon={<Dumbbell size={20} />} label="My workouts" />
        <Tile href="/app/membership" icon={<CreditCard size={20} />} label="Membership" />
      </div>
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
