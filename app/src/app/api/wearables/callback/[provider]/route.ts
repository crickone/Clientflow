import { NextResponse } from "next/server";

import { getAppBaseUrl } from "@/lib/appUrl";
import { isProviderId } from "@/lib/wearables/model";
import { exchangeCode } from "@/lib/wearables/providers";
import { openState } from "@/lib/wearables/state";
import { connectionsFor, saveConnection, syncConnection } from "@/lib/wearables/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The provider sends the member back here after they allow access. Public
 * (no session: it may be a different domain from the one they started on);
 * trust comes from the sealed state. Saves the connection, pulls the last
 * 30 days, and returns the member to their app.
 */
export async function GET(req: Request, { params }: { params: { provider: string } }) {
  const url = new URL(req.url);
  const state = openState(url.searchParams.get("state") ?? "");
  const back = (to: string, status: string) => NextResponse.redirect(`${to}/app/profile?device=${encodeURIComponent(params.provider)}&status=${status}#devices`);
  if (!state || !isProviderId(params.provider) || state.provider !== params.provider) return back(getAppBaseUrl(), "expired");
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.get("error")) return back(state.returnTo, "cancelled");
  try {
    const tokens = await exchangeCode(state.provider, code, `${getAppBaseUrl()}/api/wearables/callback/${state.provider}`, state.verifier);
    saveConnection(state.tenantId, state.clientId, state.provider, tokens);
    const conn = connectionsFor(state.tenantId, state.clientId).find((c) => c.provider === state.provider);
    if (conn) await syncConnection(conn);
    return back(state.returnTo, "connected");
  } catch (err) {
    console.error(`[wearables] ${params.provider} connect failed`, err instanceof Error ? err.message : err);
    return back(state.returnTo, "error");
  }
}
