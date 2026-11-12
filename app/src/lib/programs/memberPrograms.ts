// app/src/lib/programs/memberPrograms.ts
import "server-only";
import { and, count, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { clients, memberBuiltPrograms, programEnrolments } from "@/lib/db/schema";
import { toOwnRules } from "./convert";
import { initState } from "./engines";
import { MAX_KG, MIN_KG, bestLoggedSet, enrolTemplate, liveEnrolment, writeTemplateEdit, type EnrolInput } from "./enrolments";
import { copyKey, programByKey } from "./library";
import { editReason, normaliseOrigins, rebaseEdit } from "./memberEdit";
import { blankMemberTemplate, memberKey, parseMemberKey, validateMemberTemplate } from "./memberTemplate";
import { LIFT_EXERCISE, type LiftKey, type ProgramTemplate } from "./types";

/**
 * Programs a DIY member builds for themselves, for the CURRENT tenant
 * (ambient `db`). Every function takes the member's clientId and only reads
 * or writes that member's rows: another member's program id finds nothing.
 */

export interface MemberProgram {
  id: number;
  clientId: number;
  name: string;
  /** Checked on read; key "member:<id>". */
  template: ProgramTemplate;
  /** Maxes carried from the member's current program, offered at start. */
  maxes: Partial<Record<LiftKey, number>>;
  basedOn: string | null;
  updatedAt: number;
}

type Row = typeof memberBuiltPrograms.$inferSelect;
type Errors = { ok: false; errors: string[] };

const GONE: Errors = { ok: false, errors: ["That program no longer exists."] };
const NOT_DIY: Errors = { ok: false, errors: ["Programs are for DIY members."] };
const STALE: Errors = { ok: false, errors: ["Your program moved on while you were editing. Open it again and make the change once more."] };

const MAX_BASED_ON = 80;
/** The most programs one member keeps. */
export const MAX_MEMBER_PROGRAMS = 50;

/** Known lift keys with finite numbers from MIN_KG to MAX_KG (1 to 600 kg); anything else is dropped. Never throws. */
function cleanMaxes(raw: unknown): Partial<Record<LiftKey, number>> {
  const out: Partial<Record<LiftKey, number>> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!Object.prototype.hasOwnProperty.call(LIFT_EXERCISE, k)) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < MIN_KG || v > MAX_KG) continue;
    out[k as LiftKey] = v;
  }
  return out;
}

function toProgram(r: Row): MemberProgram | null {
  let raw: unknown;
  try {
    raw = JSON.parse(r.templateJson);
  } catch (err) {
    console.error("[programs] unreadable member program", r.id, err);
    return null;
  }
  // Unreadable maxes only lose the maxes; the program still shows.
  let maxes: Partial<Record<LiftKey, number>> = {};
  try {
    maxes = cleanMaxes(JSON.parse(r.maxesJson));
  } catch (err) {
    console.error("[programs] unreadable member program maxes", r.id, err);
  }
  // A row that no longer passes the check is skipped, so one bad row never takes the list down.
  const checked = validateMemberTemplate(raw, memberKey(r.id));
  if (!checked.ok) {
    console.error("[programs] member program fails the check", r.id, checked.errors.join(" | "));
    return null;
  }
  return { id: r.id, clientId: r.clientId, name: r.name, template: checked.template, maxes, basedOn: r.basedOn, updatedAt: r.updatedAt };
}

/** The member's own programs, most recently changed first. */
export function listMemberPrograms(clientId: number): MemberProgram[] {
  return db
    .select()
    .from(memberBuiltPrograms)
    .where(eq(memberBuiltPrograms.clientId, clientId))
    .orderBy(desc(memberBuiltPrograms.updatedAt), desc(memberBuiltPrograms.id))
    .all()
    .map(toProgram)
    .filter((p): p is MemberProgram => p !== null);
}

/** One of the member's own programs; null for another member's. */
export function getMemberProgram(clientId: number, id: number): MemberProgram | null {
  const r = db.select().from(memberBuiltPrograms).where(and(eq(memberBuiltPrograms.id, id), eq(memberBuiltPrograms.clientId, clientId))).get();
  return r ? toProgram(r) : null;
}

/** The id of the member program the member is running (active or paused), if any. */
export function runningMemberProgramId(clientId: number): number | null {
  const live = liveEnrolment(clientId);
  return live?.programKey ? parseMemberKey(live.programKey) : null;
}

export type StartFrom = { kind: "blank" } | { kind: "library"; key: string } | { kind: "current" };

/** The builder's ?from=: "blank", "current", or a library program key. */
export function parseStartFrom(raw: string | null | undefined): StartFrom | null {
  const v = (raw ?? "").trim();
  if (!v || v.length > 80) return null;
  if (v === "blank") return { kind: "blank" };
  if (v === "current") return { kind: "current" };
  return { kind: "library", key: v };
}

export interface Draft {
  template: ProgramTemplate;
  maxes: Partial<Record<LiftKey, number>>;
  basedOn: string | null;
}

/**
 * What the builder opens with. A library program comes with start weights
 * from the member's best logged sets where they have them; the current
 * program brings its maxes and its working weights. Null when the source is
 * not available to this member.
 */
export function startingDraft(clientId: number, from: StartFrom): Draft | null {
  if (from.kind === "blank") return { template: blankMemberTemplate(), maxes: {}, basedOn: null };
  if (from.kind === "library") {
    const entry = programByKey(from.key);
    if (!entry) return null;
    const t = entry.template;
    const step = db.select({ step: clients.plateStepKg }).from(clients).where(eq(clients.id, clientId)).get()?.step ?? 2.5;
    const logged: Partial<Record<LiftKey, number>> = {};
    for (const lift of t.lifts) {
      const best = bestLoggedSet(clientId, lift);
      if (best) logged[lift] = best.e1rm;
    }
    const s = initState(t, logged, step > 0 ? step : 2.5);
    return { template: toOwnRules(t, { weights: s.weights }).template, maxes: {}, basedOn: entry.copyId ? copyKey(entry.copyId) : t.key };
  }
  const live = liveEnrolment(clientId);
  if (!live) return null;
  const conv = toOwnRules(live.template, { weights: live.state.weights, tms: live.state.tms, stages: live.state.stages });
  const ownId = live.programKey ? parseMemberKey(live.programKey) : null;
  const basedOn = ownId ? (getMemberProgram(clientId, ownId)?.basedOn ?? null) : (live.programKey ?? (live.copyId ? copyKey(live.copyId) : null));
  return { template: conv.template, maxes: conv.maxes, basedOn };
}

function isDiy(clientId: number): boolean {
  return db.select({ mode: clients.trainingMode }).from(clients).where(eq(clients.id, clientId)).get()?.mode === "diy";
}

/** Save a new program. Nothing is written unless it passes the check. */
export function createMemberProgram(clientId: number, draft: { template: unknown; maxes: Partial<Record<LiftKey, number>>; basedOn: string | null }): { ok: true; id: number } | Errors {
  if (!isDiy(clientId)) return NOT_DIY;
  const checked = validateMemberTemplate(draft.template, "member:new");
  if (!checked.ok) return checked;
  const owned = db.select({ n: count() }).from(memberBuiltPrograms).where(eq(memberBuiltPrograms.clientId, clientId)).get()?.n ?? 0;
  if (owned >= MAX_MEMBER_PROGRAMS) return { ok: false, errors: [`You have ${MAX_MEMBER_PROGRAMS} programs. Delete one to build another.`] };
  const now = Date.now();
  const [row] = db
    .insert(memberBuiltPrograms)
    .values({
      clientId,
      name: checked.template.name,
      templateJson: JSON.stringify(checked.template),
      maxesJson: JSON.stringify(cleanMaxes(draft.maxes)),
      basedOn: typeof draft.basedOn === "string" && draft.basedOn.length <= MAX_BASED_ON ? draft.basedOn : null,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: memberBuiltPrograms.id })
    .all();
  return { ok: true, id: row.id };
}

/**
 * Save an edit. When the member is running this program, the new version
 * applies from the next session: the program row, the enrolment's template,
 * its state and a change-log entry are written in one transaction, or none
 * of them.
 */
export function saveMemberProgram(clientId: number, id: number, raw: unknown, weekOrigins: unknown): { ok: true; edited: boolean } | Errors {
  const row = getMemberProgram(clientId, id);
  if (!row) return GONE;
  const key = memberKey(id);
  const checked = validateMemberTemplate(raw, key);
  if (!checked.ok) return checked;
  const t = checked.template;
  const live = liveEnrolment(clientId);
  const running = !!live && live.programKey === key;
  const out = running ? rebaseEdit({ before: live.template, after: t, state: live.state, weekOrigins: weekOrigins as (number | null)[], stepKg: live.stepKg, unit: live.unit }) : null;
  const origins = running ? normaliseOrigins(weekOrigins, live.template.weeks.length, t.weeks.length, { before: live.template.weeks, after: t.weeks, current: live.state.week }) : null;
  class Stale extends Error {}
  let result: "ok" | "stale" | "gone";
  try {
    result = db.transaction((tx) => {
      const now = tx
        .select({ key: programEnrolments.programKey })
        .from(programEnrolments)
        .where(and(eq(programEnrolments.clientId, clientId), inArray(programEnrolments.status, ["active", "paused"])))
        .get();
      if ((now?.key === key) !== running) return "stale";
      const r = tx
        .update(memberBuiltPrograms)
        .set({ name: t.name, templateJson: JSON.stringify(t), updatedAt: Date.now() })
        .where(and(eq(memberBuiltPrograms.id, id), eq(memberBuiltPrograms.clientId, clientId)))
        .run();
      if (r.changes === 0) return "gone";
      // An edit that changes nothing writes no change-log event and leaves the state alone.
      if (running && out && !writeTemplateEdit(tx, live, t, out.state, out.lines.length ? editReason(out.lines) : null, origins)) throw new Stale();
      return "ok";
    });
  } catch (err) {
    if (err instanceof Stale) return STALE;
    throw err;
  }
  if (result === "gone") return GONE;
  return result === "ok" ? { ok: true, edited: running } : STALE;
}

/** Delete one of the member's programs. Refused while it is running. */
export function deleteMemberProgram(clientId: number, id: number): { ok: true } | { ok: false; error: string } {
  if (!getMemberProgram(clientId, id)) return { ok: false, error: GONE.errors[0] };
  if (runningMemberProgramId(clientId) === id) return { ok: false, error: "End this program on My program before you delete it." };
  const r = db.delete(memberBuiltPrograms).where(and(eq(memberBuiltPrograms.id, id), eq(memberBuiltPrograms.clientId, clientId))).run();
  return r.changes > 0 ? { ok: true } : { ok: false, error: GONE.errors[0] };
}

/** Start one of the member's own programs. */
export function enrolMemberProgram(clientId: number, id: number, input: Omit<EnrolInput, "key">): { ok: true; id: number } | { ok: false; error: string } {
  const p = getMemberProgram(clientId, id);
  if (!p) return { ok: false, error: "That program isn't available." };
  return enrolTemplate(clientId, input, { template: p.template, programKey: memberKey(id), copyId: null });
}
