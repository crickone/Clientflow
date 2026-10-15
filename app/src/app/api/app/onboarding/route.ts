import { NextResponse } from "next/server";

import { getCurrentClient } from "@/lib/clientAuth";
import { onboardingFor } from "@/lib/agreements";

export const dynamic = "force-dynamic";

/**
 * Whether the signed-in member has documents to agree to or a Welcome Q&A to
 * answer. The app asks when it comes back to the front, so a change the gym
 * makes while the app is open still reaches the member straight away.
 */
export async function GET() {
  const c = getCurrentClient();
  if (!c) return NextResponse.json({ pending: false });
  return NextResponse.json({ pending: onboardingFor(c.clientId) !== null }, { headers: { "Cache-Control": "no-store" } });
}
