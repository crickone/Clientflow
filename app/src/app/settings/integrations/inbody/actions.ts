"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentMembership, requireAdmin } from "@/lib/auth";
import { parseCsv } from "@/lib/memberImport";
import { testInBodyConnection } from "@/lib/inbody/api";
import { disconnectInBody, recordInBodyTest, saveInBodyConnection } from "@/lib/inbody/connection";
import { scansFromCsv } from "@/lib/inbody/metrics";
import { assignScan, deleteScan, importCsvScans, setClientInBodyId, unassignScan } from "@/lib/inbody/scans";
import { logActivity } from "@/lib/queries";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function tenantId(): number {
  return getCurrentMembership()!.tenant.id;
}

function refresh() {
  revalidatePath("/settings/integrations/inbody");
  revalidatePath("/settings");
}

const saveSchema = z.object({
  account: z.string().trim().min(1, "Add the LookinBody account name.").max(200),
  apiKey: z.string().trim().max(500).optional(),
  region: z.enum(["eur", "usa", "aus"]),
});

export async function saveInBodyAction(input: z.input<typeof saveSchema>): Promise<Result> {
  await requireAdmin();
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details and try again." };
  saveInBodyConnection(tenantId(), parsed.data);
  refresh();
  return { ok: true };
}

export async function testInBodyAction(): Promise<Result> {
  await requireAdmin();
  const t = tenantId();
  const r = await testInBodyConnection(t);
  recordInBodyTest(t, r.ok, r.ok ? null : r.error);
  refresh();
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function disconnectInBodyAction(): Promise<Result> {
  await requireAdmin();
  disconnectInBody(tenantId());
  refresh();
  return { ok: true };
}

export async function importInBodyCsvAction(csvText: string): Promise<Result<{ created: number; updated: number; matched: number; skipped: number }>> {
  await requireAdmin();
  if (!csvText || csvText.length > 10_000_000) return { ok: false, error: "That file is empty or too large." };
  const { headers, rows } = parseCsv(csvText);
  const { scans, skipped } = scansFromCsv(headers, rows);
  if (scans.length === 0) {
    return { ok: false, error: "No scans found. The file needs a test date column and at least one result column (Weight, SMM, PBF ...)." };
  }
  const r = importCsvScans(scans);
  await logActivity("inbody.import", `Imported ${scans.length} InBody scans (${r.created} new, ${r.matched} matched)`);
  refresh();
  return { ok: true, ...r, skipped };
}

export async function assignScanAction(scanId: number, clientId: number): Promise<Result<{ alsoMatched: number }>> {
  await requireAdmin();
  try {
    const alsoMatched = assignScan(scanId, clientId);
    refresh();
    revalidatePath(`/clients/${clientId}`);
    return { ok: true, alsoMatched };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't match that scan." };
  }
}

export async function unassignScanAction(scanId: number, clientId: number): Promise<Result> {
  await requireAdmin();
  unassignScan(scanId);
  refresh();
  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}

export async function deleteScanAction(scanId: number): Promise<Result> {
  await requireAdmin();
  deleteScan(scanId);
  refresh();
  return { ok: true };
}

export async function setClientInBodyIdAction(clientId: number, inbodyUserId: string): Promise<Result<{ matched: number }>> {
  await requireAdmin();
  if (inbodyUserId.length > 100) return { ok: false, error: "That ID is too long." };
  const matched = setClientInBodyId(clientId, inbodyUserId);
  revalidatePath(`/clients/${clientId}`);
  refresh();
  return { ok: true, matched };
}
