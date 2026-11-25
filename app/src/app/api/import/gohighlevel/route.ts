import { NextResponse } from "next/server";

import { guard } from "@/lib/api/guard";
import { getCurrentTenant } from "@/lib/db/tenant";
import { dryRunGhlImport, runGhlImport } from "@/lib/ghlImport/run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Settings > Import > GoHighLevel. A route (not a Server Action) because
 * the exports are bigger than a Server Action body may be. Admin only. The
 * files are read in memory and never stored.
 */
export async function POST(req: Request) {
  const denied = await guard("admin");
  if (denied) return denied;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Upload the files again." }, { status: 400 });
  }
  const contacts = form.get("contacts");
  const opportunities = form.get("opportunities");
  if (!(contacts instanceof File) || contacts.size === 0) return NextResponse.json({ ok: false, error: "Add the contacts export." }, { status: 400 });
  if (contacts.size > MAX_BYTES || (opportunities instanceof File && opportunities.size > MAX_BYTES)) {
    return NextResponse.json({ ok: false, error: "A file is over 15 MB. Export fewer columns." }, { status: 400 });
  }
  let assignees: Record<string, number | null> = {};
  try {
    const raw = JSON.parse(String(form.get("assignees") ?? "{}")) as unknown;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) assignees[k] = Number.isInteger(v) ? (v as number) : null;
    }
  } catch {
    assignees = {};
  }
  const input = {
    contactsText: await contacts.text(),
    opportunitiesText: opportunities instanceof File && opportunities.size > 0 ? await opportunities.text() : null,
    exportDay: String(form.get("exportDay") ?? ""),
    assignees,
  };
  const tenantId = getCurrentTenant().id;
  const res = form.get("mode") === "import" ? runGhlImport(tenantId, input) : dryRunGhlImport(tenantId, input);
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
