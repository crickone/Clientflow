import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { controlSqlite } from "@/lib/db/control";
import { parseSignedRequest } from "@/lib/facebook/signedRequest";
import { deleteMetaDataForUser } from "@/lib/facebook/dataDeletion";

export const dynamic = "force-dynamic";

/**
 * Meta's data deletion callback (App settings > Basic > User data deletion).
 * When someone removes the Adonis Agent app from their Facebook account, Meta
 * POSTs a signed_request naming their app-scoped user id. We verify it with the
 * app secret, record the request, and answer with a confirmation code and a
 * status URL (GET on this same route), as Meta requires. The connection data is
 * deleted at once (lib/facebook/dataDeletion); a failure leaves the request
 * 'received' for the team to finish within the 30 days the privacy policy gives.
 * Public: middleware lets /api/integrations/meta/ through; the signature is the auth.
 */

const STATUS_BASE = "https://app.adonisagent.ie/api/integrations/meta/data-deletion";

function ensureTable() {
  controlSqlite.exec(`
    CREATE TABLE IF NOT EXISTS meta_deletion_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      confirmation_code TEXT NOT NULL UNIQUE,
      fb_user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'received',
      received_at INTEGER NOT NULL,
      completed_at INTEGER
    );
  `);
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const payload = parseSignedRequest(String(form?.get("signed_request") ?? ""), process.env.FACEBOOK_APP_SECRET);
  if (!payload?.user_id) return NextResponse.json({ error: "invalid signed_request" }, { status: 400 });

  ensureTable();
  const code = crypto.randomBytes(8).toString("hex");
  controlSqlite
    .prepare("INSERT INTO meta_deletion_requests (confirmation_code, fb_user_id, received_at) VALUES (?, ?, ?)")
    .run(code, String(payload.user_id), Date.now());
  console.log(`[meta] data deletion request received: code ${code}`);

  // Done straight away: the connection data is removed and the request marked
  // completed, so the status page Meta links to can say so.
  try {
    const tenants = await deleteMetaDataForUser(String(payload.user_id));
    controlSqlite
      .prepare("UPDATE meta_deletion_requests SET status = 'completed', completed_at = ? WHERE confirmation_code = ?")
      .run(Date.now(), code);
    console.log(`[meta] data deletion ${code}: completed (${tenants.length} connection(s) removed)`);
  } catch (err) {
    // Left as 'received' so it is visible and can be finished by hand.
    console.error(`[meta] data deletion ${code} failed:`, err);
  }

  return NextResponse.json({ url: `${STATUS_BASE}?code=${code}`, confirmation_code: code });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get("code") ?? "").trim();
  ensureTable();
  const row = code
    ? (controlSqlite.prepare("SELECT status, received_at, completed_at FROM meta_deletion_requests WHERE confirmation_code = ?").get(code) as
        | { status: string; received_at: number; completed_at: number | null }
        | undefined)
    : undefined;
  const day = (ms: number) => new Date(ms).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" });
  const body = row
    ? row.completed_at
      ? `Your request ${esc(code)} was completed on ${day(row.completed_at)}. The data AdonisAgent held from your Facebook account has been deleted.`
      : `Your request ${esc(code)} was received on ${day(row.received_at)} and will be completed within 30 days.`
    : "We could not find a deletion request with that code.";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Data deletion request</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:560px;margin:64px auto;padding:0 16px;color:#111;background:#fff}@media (prefers-color-scheme:dark){body{color:#eee;background:#111}a{color:#9cf}}</style></head>
<body><h1 style="font-size:22px">Data deletion request</h1><p>${body}</p><p>Questions: <a href="mailto:privacy@adonisagent.ie">privacy@adonisagent.ie</a>. AdonisAgent is a product of Vantaige Limited.</p></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
