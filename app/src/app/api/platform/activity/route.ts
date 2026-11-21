import { NextResponse, type NextRequest } from "next/server";

import { guardPlatform } from "@/lib/platform/auth";
import { getFleetActivity } from "@/lib/platform/activity";

export const dynamic = "force-dynamic";

/** Each business's week: last login, active members, bookings, leads, sales, AI spend, setup. */
export async function GET(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  return NextResponse.json(getFleetActivity());
}
