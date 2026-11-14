// app/src/lib/programs/coachPrograms.ts
import "server-only";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { clients, programEnrolments } from "@/lib/db/schema";
import { MAX_KG, endEnrolment, getEnrolmentFor, insertEnrolment, liveEnrolment, logEnrolmentEvent, tmLine, writeTemplateEdit, type EnrolInput, type StaffActor } from "./enrolments";
import { programByKey } from "./library";
import { editReason, normaliseOrigins, rebaseEdit } from "./memberEdit";
import { initState } from "./engines";
import { LIFT_LABEL, type ProgramTemplate } from "./types";
import { copyErrors, parseTemplate, templateErrors } from "./validate";

/**
 * A coach sets a library program for one member, edits that person's copy
 * (the enrolment's own template snapshot), and ends it. The copy keeps the
 * program's own engine. Ambient tenant `db`: a member of another business is
 * simply not found.
 */

export type AssignInput = Omit<EnrolInput, "key"> & { key: string; template: unknown | null; replace: boolean };
export type AssignResult = { ok: true; id: number } | { ok: false; error: string; needsReplace?: true; errors?: string[] };

/** The coach's draft of a person's copy, checked like a gym version: the template check plus every lift the original's engine needs. */
export function checkPersonCopy(original: ProgramTemplate, raw: unknown): { ok: true; template: ProgramTemplate } | { ok: false; errors: string[] } {
  const parsed = parseTemplate(raw);
  if (!parsed.ok) return parsed;
  // The engine is the original's, whatever the draft says; the rules are then checked against it.
  const t: ProgramTemplate = { ...parsed.template, key: original.key, engine: original.engine, tmPct: original.tmPct, lifts: original.lifts };
  const errors = [...copyErrors(original, t), ...templateErrors(t)];
  return errors.length ? { ok: false, errors: [...new Set(errors)] } : { ok: true, template: t };
}

export function coachAssign(clientId: number, input: AssignInput, actor: StaffActor): AssignResult {
  const member = db.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId)).get();
  if (!member) return { ok: false, error: "Member not found." };
  const entry = programByKey(input.key);
  if (!entry) return { ok: false, error: "That program isn't available." };
  let t = entry.template;
  if (input.template !== null) {
    const checked = checkPersonCopy(entry.template, input.template);
    if (!checked.ok) return { ok: false, error: checked.errors[0], errors: checked.errors };
    t = checked.template;
  }
  for (const lift of t.lifts) {
    const m = input.maxesKg[lift];
    if (!m || !Number.isFinite(m) || m <= 0 || m > MAX_KG) return { ok: false, error: `Add a ${LIFT_LABEL[lift].toLowerCase()} max.` };
  }
  const live = liveEnrolment(clientId);
  if (live && !input.replace) return { ok: false, error: `${live.template.name} is running. Setting a new program ends it.`, needsReplace: true };
  const state = initState(t, input.maxesKg, input.stepKg);
  try {
    const id = db.transaction((tx) => {
      if (live) {
        const r = tx
          .update(programEnrolments)
          .set({ status: "ended", endedAt: Date.now(), updatedAt: Date.now() })
          .where(and(eq(programEnrolments.id, live.id), inArray(programEnrolments.status, ["active", "paused"])))
          .run();
        if (r.changes > 0) logEnrolmentEvent(tx, live.id, actor, "end", `${actor.name} ended this program to set a new one.`, live.state);
      }
      return insertEnrolment(tx, clientId, input, { template: t, programKey: entry.copyId ? null : t.key, copyId: entry.copyId }, {
        actor,
        reason: `${actor.name} set this program: ${t.name}.${tmLine(t, state, input.unit)}`,
        assignedBy: actor.userId,
      });
    });
    return { ok: true, id };
  } catch (err) {
    if (String(err).includes("UNIQUE")) return { ok: false, error: "The member's program changed. Try again." };
    throw err;
  }
}

export function coachEditProgram(clientId: number, enrolmentId: number, raw: unknown, weekOrigins: unknown, actor: StaffActor): { ok: true } | { ok: false; errors: string[] } {
  const view = getEnrolmentFor(clientId, enrolmentId);
  if (!view || view.status === "ended") return { ok: false, errors: ["That program has ended."] };
  if (!view.assignedBy) return { ok: false, errors: ["The member chose this program, so only they can change it."] };
  const original = (view.copyId ? programByKey(`copy-${view.copyId}`)?.template : view.programKey ? programByKey(view.programKey, { includeHidden: true })?.template : null) ?? view.template;
  const checked = checkPersonCopy(original, raw);
  if (!checked.ok) return checked;
  const t = checked.template;
  const origins = normaliseOrigins(weekOrigins, view.template.weeks.length, t.weeks.length, { before: view.template.weeks, after: t.weeks, current: view.state.week });
  const out = rebaseEdit({ before: view.template, after: t, state: view.state, weekOrigins: origins, stepKg: view.stepKg, unit: view.unit });
  const ok = db.transaction((tx) => writeTemplateEdit(tx, view, t, out.state, out.lines.length ? editReason(out.lines, actor.name) : null, origins, actor));
  return ok ? { ok: true } : { ok: false, errors: ["The member's program moved on while you were editing. Open it again."] };
}

export function coachEndProgram(clientId: number, enrolmentId: number, actor: StaffActor): { ok: true } | { ok: false; error: string } {
  const view = getEnrolmentFor(clientId, enrolmentId);
  if (!view || view.status === "ended") return { ok: false, error: "That program has ended." };
  return endEnrolment(clientId, actor) ? { ok: true } : { ok: false, error: "That program has ended." };
}
