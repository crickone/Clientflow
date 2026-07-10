import { guard } from "@/lib/api/guard";
import { NextResponse, type NextRequest } from "next/server";
import { listPackagesForClient } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const clientId = Number(req.nextUrl.searchParams.get("clientId") ?? 0);
  const therapyId = Number(req.nextUrl.searchParams.get("therapyId") ?? 0);
  if (!clientId) return NextResponse.json([]);
  const rows = await listPackagesForClient(
    clientId,
    therapyId || undefined,
  );
  // Filter out expired
  const today = new Date().toISOString().slice(0, 10);
  return NextResponse.json(
    rows.filter((r) => r.expiryDate >= today && r.sessionsUsed < r.totalSessions),
  );
}
