import "server-only";

import { runWithTenant } from "@/lib/db/tenant";
import { flowNow } from "@/lib/leadFlows/clock";
import { addDays, todayIn } from "@/lib/leadFlows/sendingWindow";

import { applyPlan } from "./apply";
import { parseGhlContacts, parseGhlOpportunities, type GhlOpportunity, type ReadResult } from "./csv";
import { buildPlan, dryRunRows, joinPeople, type ImportPlan } from "./plan";
import { loadSnapshot } from "./snapshot";
import type { DryRunResponse, ImportResponse } from "./types";

export const MAX_PEOPLE = 20_000;

export interface GhlImportInput {
  contactsText: string;
  opportunitiesText: string | null;
  /** "YYYY-MM-DD", the day the files were exported. */
  exportDay: string;
  /** GoHighLevel user name -> Adonis user id; null = the default assignee. */
  assignees?: Record<string, number | null>;
}

/** Null when the day is usable, else what to change. */
export function checkExportDay(day: string, now: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? "")) return "Enter the day you exported the files.";
  const today = todayIn(now);
  if (day > today) return "The export date can't be in the future.";
  if (day < addDays(today, -365)) return "The export date is more than a year ago. Export the files again.";
  return null;
}

function prepare(tenantId: number, input: GhlImportInput, now: number): { ok: true; plan: ImportPlan; staff: { userId: number; name: string }[]; defaultAssigneeUserId: number | null } | { ok: false; error: string } {
  const dayError = checkExportDay(input.exportDay, now);
  if (dayError) return { ok: false, error: dayError };
  const contacts = parseGhlContacts(input.contactsText);
  if (!contacts.ok) return contacts;
  const opps = input.opportunitiesText ? parseGhlOpportunities(input.opportunitiesText) : ({ ok: true, rows: [] } as ReadResult<GhlOpportunity>);
  if (!opps.ok) return opps;
  const people = joinPeople(contacts.rows, opps.rows);
  if (people.length === 0) return { ok: false, error: "There is nobody in these files." };
  if (people.length > MAX_PEOPLE) return { ok: false, error: `These files have more than ${MAX_PEOPLE.toLocaleString("en-IE")} people. Split the export.` };
  const snap = loadSnapshot(tenantId);
  return { ok: true, plan: buildPlan(people, snap, { exportDay: input.exportDay, now, assignees: input.assignees }), staff: snap.staff, defaultAssigneeUserId: snap.defaultAssigneeUserId };
}

/** What would happen. Writes nothing. */
export function dryRunGhlImport(tenantId: number, input: GhlImportInput): DryRunResponse {
  return runWithTenant(tenantId, () => {
    const now = flowNow();
    const prep = prepare(tenantId, input, now);
    if (!prep.ok) return prep;
    const def = prep.staff.find((s) => s.userId === prep.defaultAssigneeUserId) ?? null;
    return {
      ok: true,
      totals: prep.plan.totals,
      rows: dryRunRows(prep.plan),
      assignees: prep.plan.assignees,
      staff: prep.staff,
      defaultAssigneeName: def?.name ?? null,
      exportDay: input.exportDay,
      now,
    };
  });
}

/** The import: the plan is worked out again here, from the files, never taken from the browser. */
export function runGhlImport(tenantId: number, input: GhlImportInput): ImportResponse {
  return runWithTenant(tenantId, () => {
    const now = flowNow();
    const prep = prepare(tenantId, input, now);
    if (!prep.ok) return prep;
    return { ok: true, result: applyPlan(prep.plan, { tenantId, now }) };
  });
}
