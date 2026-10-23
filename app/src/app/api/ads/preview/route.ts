import { NextResponse } from "next/server";

import { guard } from "@/lib/api/guard";
import { adPreviewData } from "@/lib/ads/pageData";

export const dynamic = "force-dynamic";

/** Images and Page details for the ads Adonis proposes, so the approval card can show the ad itself. Staff only, current business. */
export async function GET(req: Request) {
  const denied = await guard("user");
  if (denied) return denied;
  const ids = (new URL(req.url).searchParams.get("designs") ?? "")
    .split(",")
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);
  return NextResponse.json(adPreviewData(ids, new URL(req.url).searchParams.get("account")));
}
