import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AssignProgramFlow } from "@/components/clients/AssignProgramFlow";
import { PageHeader } from "@/components/layout/PageHeader";
import { db } from "@/lib/db";
import { clients } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { cardLine, defaultWeekdays, groupByGoal, toCard, byline } from "@/lib/programs/cards";
import { isFullBlock } from "@/lib/programs/editing";
import { bestLoggedSet, liveEnrolment, planContextFor } from "@/lib/programs/enrolments";
import { memberPrograms, programByKey } from "@/lib/programs/library";
import { currentStaffActor } from "@/lib/programs/staffActor";
import { ENGINE_LABEL, LIFT_LABEL } from "@/lib/programs/types";
import { keyFromStep } from "@/lib/programs/units";
import { dateKey } from "@/lib/trainingProgress";

export const dynamic = "force-dynamic";

export default async function AssignProgramPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ key?: string | string[] }> }) {
  // Signs the user in and is null where Programs is off for this business.
  if (!(await currentStaffActor())) notFound();
  const { id } = await props.params;
  const n = Number(id);
  const client = Number.isInteger(n) && n > 0 ? db.select().from(clients).where(eq(clients.id, n)).get() : undefined;
  if (!client) notFound();
  const sp = await props.searchParams;
  const rawKey = Array.isArray(sp.key) ? sp.key[0] : sp.key;
  const first = client.firstName || "this member";
  const back = (
    <Link href={`/clients/${client.id}`} className="cp-back">
      <ArrowLeft size={14} /> {client.firstName ?? "Client"}
    </Link>
  );

  if (!rawKey) {
    const groups = groupByGoal(memberPrograms().map((e) => ({ ...toCard(e.template, e.basedOnName) })));
    return (
      <div className="app-page">
        {back}
        <PageHeader title={`Set a program for ${first}`} subtitle="Pick a program. You can change it for them before it starts." />
        {groups.length === 0 ? (
          <p>No programs are available yet.</p>
        ) : (
          groups.map((g) => (
            <section key={g.family} style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>{g.label}</h2>
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
                {g.cards.map((c) => (
                  <Link key={c.key} href={`/clients/${client.id}/program/assign?key=${encodeURIComponent(c.key)}`} className="ui-card" style={{ display: "grid", gap: 4, padding: 14, textDecoration: "none", color: "inherit" }}>
                    <strong>{c.name}</strong>
                    <span style={{ fontSize: 13, color: "var(--text-tertiary)" }}>{byline(c)}</span>
                    <span style={{ fontSize: 13 }}>{c.who}</span>
                    <span style={{ fontSize: 13, color: "var(--text-tertiary)" }}>{cardLine(c)}</span>
                  </Link>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    );
  }

  let key: string;
  try {
    key = decodeURIComponent(rawKey);
  } catch {
    notFound();
  }
  const entry = programByKey(key);
  if (!entry) notFound();
  const t = entry.template;
  const lifts = t.lifts.map((lift) => {
    const b = bestLoggedSet(client.id, lift);
    return { lift, label: LIFT_LABEL[lift], logged: b ? { kg: b.kg, reps: b.reps, e1rm: b.e1rm } : null };
  });
  const live = liveEnrolment(client.id);
  return (
    <div className="app-page">
      <Link href={`/clients/${client.id}/program/assign`} className="cp-back">
        <ArrowLeft size={14} /> All programs
      </Link>
      <PageHeader title={`Set ${t.name} for ${first}`} subtitle={cardLine(toCard(t))} />
      <AssignProgramFlow
        clientId={client.id}
        memberName={first}
        programKey={t.key}
        template={t}
        lifts={lifts}
        extra={planContextFor(client.id, t)}
        initialUnit={client.weightUnit === "lb" ? "lb" : "kg"}
        initialStep={keyFromStep(client.plateStepKg)}
        defaultWeekdays={defaultWeekdays(t.daysPerWeek)}
        today={dateKey(Date.now())}
        liveName={live ? live.template.name : null}
        engineLabel={ENGINE_LABEL[t.engine.key]}
        isBlock={t.engine.key === "fixed_block"}
        fullBlock={isFullBlock(t)}
      />
    </div>
  );
}
