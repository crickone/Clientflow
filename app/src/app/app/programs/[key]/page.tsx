// app/src/app/app/programs/[key]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { requireProgramsPage } from "@/lib/programs/access";
import { byline, cardLine, toCard } from "@/lib/programs/cards";
import { liveEnrolment } from "@/lib/programs/enrolments";
import { programByKey } from "@/lib/programs/library";
import { setsFor, summariseRx } from "@/lib/programs/planner";
import { LIFT_LABEL } from "@/lib/programs/types";
import { Card, PageTitle, SectionTitle } from "@/components/clientapp/ui";

export const dynamic = "force-dynamic";

export default async function ProgramDetailPage(props: { params: Promise<{ key: string }> }) {
  const { key } = await props.params;
  const { clientId } = requireProgramsPage();
  // A malformed escape (e.g. "%E0%A4%A") makes decodeURIComponent throw: a 404, not a 500.
  let programKey: string;
  try {
    programKey = decodeURIComponent(key);
  } catch {
    notFound();
  }
  const entry = programByKey(programKey);
  if (!entry) notFound();
  const t = entry.template;
  const card = toCard(t, entry.basedOnName);
  const live = liveEnrolment(clientId);
  const firstWeek = t.weeks[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub={byline(card)}>{t.name}</PageTitle>
      <Card style={{ display: "grid", gap: 8 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" }}>
          {cardLine(card)}. {card.levelLabel} level.
        </div>
        <div style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>{t.who}</div>
        {t.warning && (
          <div className="pg-warning">
            <AlertTriangle size={14} aria-hidden />
            <span>{t.warning}</span>
          </div>
        )}
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>{t.description}</p>
        {t.lifts.length > 0 && (
          <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>You need a max for: {t.lifts.map((l) => LIFT_LABEL[l].toLowerCase()).join(", ")}.</div>
        )}
      </Card>

      <SectionTitle>{firstWeek.label ? `Week 1: ${firstWeek.label}` : "Week 1"}</SectionTitle>
      {firstWeek.days.map((d, i) => (
        <Card key={i} style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{d.name}</div>
          {d.exercises.map((ex, j) => (
            <div key={j} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
              <span style={{ color: "var(--text-primary)" }}>{ex.name}</span>
              <span style={{ color: "var(--text-secondary)", textAlign: "right" }}>{summariseRx(setsFor(ex, {}))}</span>
            </div>
          ))}
        </Card>
      ))}
      {t.weeks.length > 1 && (
        <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", textAlign: "center" }}>
          {t.weeks.length} different weeks in all. Your weights are worked out when you start.
        </div>
      )}

      {live ? (
        <Card style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>
          You&rsquo;re running {live.template.name}. End it on{" "}
          <Link href="/app/programs/mine" style={{ color: "var(--accent-ink)" }}>
            My program
          </Link>{" "}
          before you start another.
        </Card>
      ) : (
        <Link href={`/app/programs/${encodeURIComponent(t.key)}/start`} className="pg-cta">
          Start this program
        </Link>
      )}
    </div>
  );
}
