import { NextResponse } from "next/server";

import { guard } from "@/lib/api/guard";
import { checkOutgoingFile, OUTGOING_LIMITS, OUTGOING_MISMATCH_ERROR, OUTGOING_TOO_BIG_ERROR, sniffMatches } from "@/lib/attachments/outgoingModel";
import { attachmentTokensConfigured, signAttachment } from "@/lib/attachments/token";
import { getCurrentTenant } from "@/lib/db/tenant";
import { saveMediaFile } from "@/lib/inbox/media";

export const dynamic = "force-dynamic";

/** Room for the multipart boundaries and part headers around one file. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * POST /api/messages/attachments: one file a staff member is about to send
 * in a one-to-one chat (multipart form field `file`).
 *
 * The file is checked (type allowlist, 16 MB cap, first bytes match the
 * type), stored in the business's PRIVATE inbox-media folder (the same store
 * as inbound media, served only to its signed-in staff by
 * /api/inbox/media/[file]) and answered with a signed, expiring ticket. The
 * composer then sends its message with the tickets; the send action turns
 * them back into files with lib/attachments/load.ts.
 *
 * Body size: this is a route handler reading req.formData(), so the server
 * action body limit does not apply here. The one limit in front of it is the
 * middleware's request-body buffer (experimental.middlewareClientMaxBodySize
 * in next.config.mjs, raised to 20 MB so a 16 MB file arrives whole).
 */
export async function POST(req: Request) {
  const denied = await guard("user");
  if (denied) return denied;

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > OUTGOING_LIMITS.maxFileBytes + MULTIPART_OVERHEAD_BYTES) {
    return NextResponse.json({ ok: false, error: OUTGOING_TOO_BIG_ERROR }, { status: 413 });
  }
  if (!attachmentTokensConfigured()) {
    return NextResponse.json({ ok: false, error: "Attachments are not set up on this server." }, { status: 500 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "No file was sent." }, { status: 400 });
  }
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ ok: false, error: "No file was sent." }, { status: 400 });
  }
  if (file.size > OUTGOING_LIMITS.maxFileBytes) {
    return NextResponse.json({ ok: false, error: OUTGOING_TOO_BIG_ERROR }, { status: 413 });
  }

  const name = (file.name ?? "").trim();
  const check = checkOutgoingFile({ name, size: file.size, mime: file.type });
  if (!check.ok) return NextResponse.json({ ok: false, error: check.error }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  if (!sniffMatches(check.mime, buf.subarray(0, 1024))) {
    return NextResponse.json({ ok: false, error: OUTGOING_MISMATCH_ERROR }, { status: 400 });
  }

  const tenant = getCurrentTenant();
  const media = saveMediaFile(tenant.slug, buf, check.mime, name || undefined);
  const token = signAttachment(tenant.id, media);
  return NextResponse.json({
    ok: true,
    token,
    media: { kind: media.kind, file: media.file, mime: media.mime, name: media.name, size: media.size },
  });
}
