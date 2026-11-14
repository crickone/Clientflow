// app/src/app/app/programs/[key]/page.tsx
import { notFound } from "next/navigation";

import { requireProgramsPage } from "@/lib/programs/access";
import { currentPhase, programContent, withContentFrom, type ContentSource, type ProgramContent } from "@/lib/programs/content";
import { liveEnrolment } from "@/lib/programs/enrolments";
import { programByKey } from "@/lib/programs/library";
import { getMemberProgram } from "@/lib/programs/memberPrograms";
import { memberKey, parseMemberKey } from "@/lib/programs/memberTemplate";
import type { ProgramTemplate } from "@/lib/programs/types";
import { shownStepKg } from "@/lib/programs/units";
import { ProgramDetail, type DetailAction } from "@/components/clientapp/programs/ProgramDetail";

export const dynamic = "force-dynamic";

/** A library program (platform key or "copy-<id>"), or one of the member's own ("member:<id>"). */
export default async function ProgramDetailPage(props: { params: Promise<{ key: string }> }) {
  const { key } = await props.params;
  const { clientId, client } = requireProgramsPage();
  // A malformed escape (e.g. "%E0%A4%A") makes decodeURIComponent throw: a 404, not a 500.
  let programKey: string;
  try {
    programKey = decodeURIComponent(key);
  } catch {
    notFound();
  }
  const live = liveEnrolment(clientId);
  const ownId = parseMemberKey(programKey);
  let t: ProgramTemplate;
  let content: ProgramContent;
  let src: ContentSource;
  let running: boolean;
  let startHref: string;
  if (ownId !== null) {
    // Only the member's own: another member's id finds nothing.
    const p = getMemberProgram(clientId, ownId);
    if (!p) notFound();
    t = p.template;
    src = { kind: "member" };
    content = programContent(t, src);
    running = live?.programKey === memberKey(ownId);
    startHref = `/app/programs/built/${ownId}/start`;
  } else {
    const entry = programByKey(programKey);
    if (!entry) notFound();
    t = entry.template;
    src = entry.copyId !== null ? { kind: "copy", basedOnName: entry.basedOnName ?? t.name } : { kind: "platform" };
    content = programContent(t, src);
    running = !!live && (entry.copyId !== null ? live.copyId === entry.copyId : live.programKey === t.key);
    startHref = `/app/programs/${encodeURIComponent(t.key)}/start`;
  }
  const action: DetailAction = running ? { kind: "continue" } : live ? { kind: "busy", runningName: live.template.name, coachSet: live.assignedBy !== null } : { kind: "start", href: startHref };
  const unit = running && live ? live.unit : client.weightUnit === "lb" ? "lb" : "kg";
  const stepKg = shownStepKg(unit, running && live ? live.stepKg : client.plateStepKg);
  return (
    <ProgramDetail
      template={t}
      content={content}
      memberBuilt={ownId !== null}
      current={running && live && !live.state.finished ? currentPhase(programContent(withContentFrom(live.template, t), src), live.template, live.state) : null}
      unit={unit}
      stepKg={stepKg}
      action={action}
      editHref={ownId !== null && !(running && live?.assignedBy) ? `/app/programs/built/${ownId}` : undefined}
    />
  );
}
