// app/src/lib/programs/library.ts
import "server-only";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { programLibraryHidden, programTemplates } from "@/lib/db/schema";
import { PLATFORM_PROGRAMS, platformProgram } from "./registry";
import type { ProgramTemplate } from "./types";
import { isFullBlock, mostDays } from "./editing";
import { copyErrors, parseTemplate, templateErrors } from "./validate";

/**
 * What one gym's members can pick from: the gym's own versions of platform
 * programs (tenant DB) plus the platform programs it has not hidden. Ambient
 * tenant `db`.
 */

export const COPY_PREFIX = "copy-";

export function copyKey(id: number): string {
  return `${COPY_PREFIX}${id}`;
}

export function parseCopyKey(key: string): number | null {
  if (!key.startsWith(COPY_PREFIX)) return null;
  const n = Number(key.slice(COPY_PREFIX.length));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function hiddenKeys(): Set<string> {
  return new Set(db.select({ k: programLibraryHidden.programKey }).from(programLibraryHidden).all().map((r) => r.k));
}

/** Hide or show a platform program for this gym's members. Unknown keys are refused. */
export function setHidden(key: string, hidden: boolean, userId: number | null): boolean {
  if (!platformProgram(key)) return false;
  if (hidden) db.insert(programLibraryHidden).values({ programKey: key, hiddenBy: userId, hiddenAt: Date.now() }).onConflictDoNothing().run();
  else db.delete(programLibraryHidden).where(eq(programLibraryHidden.programKey, key)).run();
  return true;
}

export interface CopyRow {
  id: number;
  basedOn: string;
  basedOnName: string;
  name: string;
  template: ProgramTemplate;
  updatedAt: number;
}

function toCopy(r: typeof programTemplates.$inferSelect): CopyRow | null {
  let raw: unknown;
  try {
    raw = JSON.parse(r.templateJson);
  } catch (err) {
    console.error("[programs] unreadable gym copy", r.id, err);
    return null;
  }
  // Valid JSON that no longer fits the template shape is skipped the same way, so one bad row never takes the list down.
  const parsed = parseTemplate(raw);
  if (!parsed.ok) {
    console.error("[programs] gym copy fails the template check", r.id, parsed.errors.join(" | "));
    return null;
  }
  const template = parsed.template;
  return {
    id: r.id,
    basedOn: r.basedOn,
    basedOnName: platformProgram(r.basedOn)?.name ?? r.basedOn,
    name: r.name,
    template: { ...template, key: copyKey(r.id), name: r.name },
    updatedAt: r.updatedAt,
  };
}

export function listCopies(): CopyRow[] {
  return db
    .select()
    .from(programTemplates)
    .orderBy(desc(programTemplates.updatedAt))
    .all()
    .map(toCopy)
    .filter((c): c is CopyRow => c !== null);
}

export function getCopy(id: number): CopyRow | null {
  const r = db.select().from(programTemplates).where(eq(programTemplates.id, id)).get();
  return r ? toCopy(r) : null;
}

/** "Make our version": a copy of a platform program in this gym's DB. */
export function makeCopy(platformKey: string, userId: number | null): number | null {
  const original = platformProgram(platformKey);
  if (!original) return null;
  const now = Date.now();
  const [row] = db
    .insert(programTemplates)
    .values({ basedOn: original.key, engine: original.engine.key, name: original.name, templateJson: JSON.stringify(original), createdBy: userId, createdAt: now, updatedAt: now })
    .returning({ id: programTemplates.id })
    .all();
  return row.id;
}

/**
 * Save an edited copy. The engine, the lifts it needs, the training-max rule,
 * family and author always come from the original; the copy must still use
 * every lift the engine needs. Days a week is the most days in any week, and
 * a copy of a full block is as long as its weeks. Nothing is written unless
 * it all passes.
 */
export function saveCopy(id: number, raw: unknown): { ok: true } | { ok: false; errors: string[] } {
  const row = getCopy(id);
  if (!row) return { ok: false, errors: ["That version no longer exists."] };
  const original = platformProgram(row.basedOn);
  if (!original) return { ok: false, errors: ["The program it was based on is no longer in the library."] };
  const parsed = parseTemplate(raw);
  if (!parsed.ok) return parsed;
  const t: ProgramTemplate = {
    ...parsed.template,
    key: copyKey(id),
    engine: original.engine,
    lifts: original.lifts,
    tmPct: original.tmPct,
    family: original.family,
    author: original.author,
  };
  // A full block is as long as its weeks; a repeated cycle keeps the length it was given.
  if (isFullBlock(original)) t.lengthWeeks = t.weeks.length;
  t.daysPerWeek = mostDays(t);
  const missing = copyErrors(original, t);
  if (missing.length) return { ok: false, errors: missing };
  const errors = templateErrors(t);
  if (errors.length) return { ok: false, errors };
  db.update(programTemplates).set({ name: t.name, templateJson: JSON.stringify(t), updatedAt: Date.now() }).where(eq(programTemplates.id, id)).run();
  return { ok: true };
}

export function deleteCopy(id: number): boolean {
  return db.delete(programTemplates).where(eq(programTemplates.id, id)).run().changes > 0;
}

export interface LibraryEntry {
  template: ProgramTemplate;
  /** For a gym copy: the platform program it is based on. */
  basedOnName: string | null;
  copyId: number | null;
  hidden: boolean;
}

/** A program by its key: a platform key, or "copy-<id>". Hidden platform programs only with includeHidden. */
export function programByKey(key: string, opts: { includeHidden?: boolean } = {}): LibraryEntry | null {
  const copyId = parseCopyKey(key);
  if (copyId) {
    const c = getCopy(copyId);
    return c ? { template: c.template, basedOnName: c.basedOnName, copyId: c.id, hidden: false } : null;
  }
  const t = platformProgram(key);
  if (!t) return null;
  const hidden = hiddenKeys().has(key);
  if (hidden && !opts.includeHidden) return null;
  return { template: t, basedOnName: null, copyId: null, hidden };
}

/** What a member can browse: the gym's copies, then the platform programs it has not hidden. */
export function memberPrograms(): LibraryEntry[] {
  const hidden = hiddenKeys();
  return [
    ...listCopies().map((c) => ({ template: c.template, basedOnName: c.basedOnName, copyId: c.id, hidden: false })),
    ...PLATFORM_PROGRAMS.filter((t) => !hidden.has(t.key)).map((t) => ({ template: t, basedOnName: null, copyId: null, hidden: false })),
  ];
}
