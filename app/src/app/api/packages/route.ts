import { guard } from "@/lib/api/guard";
import { NextResponse, type NextRequest } from "next/server";
import { listPackagesForClient } from "@/lib/queries";
import { bookedByPackage } from "@/lib/packageBalance";
import { sessionsLeft, usableOn } from "@/lib/packageBalanceModel";

export const dynamic = "force-dynamic";

/**
 * The client's packages that can pay for a booking: not expired by the
 * booking's date (`date`, default today) and with a session left once the
 * sessions already booked on it are held. Each row carries `available`.
 */
export async function GET(req: NextRequest) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const clientId = Number(req.nextUrl.searchParams.get("clientId") ?? 0);
  const therapyId = Number(req.nextUrl.searchParams.get("therapyId") ?? 0);
  const rawDate = req.nextUrl.searchParams.get("date") ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : new Date().toISOString().slice(0, 10);
  if (!clientId) return NextResponse.json([]);
  const rows = await listPackagesForClient(clientId, therapyId || undefined);
  const booked = bookedByPackage(rows.map((r) => r.id));
  return NextResponse.json(
    rows
      .filter((r) => r.isActive !== false && usableOn(r.expiryDate, date))
      .map((r) => ({ ...r, booked: booked.get(r.id) ?? 0, available: sessionsLeft(r, booked.get(r.id) ?? 0) }))
      .filter((r) => r.available > 0),
  );
}
