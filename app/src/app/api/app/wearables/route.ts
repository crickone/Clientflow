import { NextResponse } from "next/server";

import { getCurrentClient } from "@/lib/clientAuth";
import { getAppBaseUrl } from "@/lib/appUrl";
import { isProviderId } from "@/lib/wearables/model";
import { authorizeUrl, isProviderConfigured, pkcePair } from "@/lib/wearables/providers";
import { sealState } from "@/lib/wearables/state";
import { disconnect } from "@/lib/wearables/store";

export const dynamic = "force-dynamic";

/** Start connecting a device: off to the provider's sign-in, back to /api/wearables/callback/<provider>. */
export async function GET(req: Request) {
  const c = getCurrentClient();
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider");
  if (!c) return NextResponse.redirect(new URL("/app/login", url));
  if (!isProviderId(provider) || !isProviderConfigured(provider)) return NextResponse.redirect(new URL("/app/profile?device=unavailable", url));
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const { verifier, challenge } = pkcePair();
  const state = sealState({ tenantId: c.tenantId, clientId: c.clientId, provider, verifier, returnTo: `${proto}://${host}` });
  const redirectUri = `${getAppBaseUrl()}/api/wearables/callback/${provider}`;
  return NextResponse.redirect(authorizeUrl(provider, { state, redirectUri, challenge }));
}

/** Disconnect a device: { provider }. */
export async function DELETE(req: Request) {
  const c = getCurrentClient();
  if (!c) return NextResponse.json({ ok: false }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { provider?: string } | null;
  if (!isProviderId(body?.provider)) return NextResponse.json({ ok: false, error: "Unknown device." }, { status: 400 });
  await disconnect(c.tenantId, c.clientId, body!.provider as never);
  return NextResponse.json({ ok: true });
}
