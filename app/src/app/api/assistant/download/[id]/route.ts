import { type NextRequest } from "next/server";

import { requireUser, getCurrentMembership } from "@/lib/auth";
import { readDownload } from "@/lib/assistant/downloadStore";

export const dynamic = "force-dynamic";

/** Serve an AI-generated bundle (e.g. invoices.zip) to the signed-in tenant. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireUser();
  const membership = getCurrentMembership();
  if (!membership) return new Response("No active account", { status: 401 });

  const file = readDownload(membership.tenant.id, params.id);
  if (!file) return new Response("Not found or expired", { status: 404 });

  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Content-Length": String(file.bytes.length),
      "Cache-Control": "no-store",
    },
  });
}
