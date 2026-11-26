import { NextResponse } from "next/server";

import { guard } from "@/lib/api/guard";
import { syncClientWhatsApp } from "@/lib/whatsapp/history";

/** Fill in the client's WhatsApp chat from the business's own WhatsApp (lib/whatsapp/history). */
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const denied = await guard("user");
  if (denied) return denied;
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ ok: false, error: "Bad client id." }, { status: 400 });
  const res = await syncClientWhatsApp(id);
  return NextResponse.json({ ok: true, ...res });
}
