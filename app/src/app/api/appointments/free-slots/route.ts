import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api/guard";
import { BOOKING_STEP_MINUTES, blocksCoverDay, slotCandidates } from "@/lib/booking/slotModel";
import { blockOutsForDate, checkBookingSlot, dayWindow } from "@/lib/schedule";
import { mondayOf } from "@/lib/scheduling/rotaModel";
import { weekUnfilled } from "@/lib/scheduling/rotaRepo";

export const dynamic = "force-dynamic";

/** The longest session the screen asks about: a whole day. */
const MAX_DURATION = 24 * 60;

/**
 * GET /api/appointments/free-slots?date=YYYY-MM-DD&duration=N&therapyIds=1,2
 *
 * The start times the booking screen offers for one day, each marked free or
 * taken. Free means `checkBookingSlot` accepts it: the SAME check POST
 * /api/appointments runs (opening hours, block-outs, resource limits, buffer,
 * and the staff rule when the rota is on), so a time shown as free is a time
 * the booking goes through at.
 * Staff only.
 */
export async function GET(req: NextRequest) {
  const denied = await guard("user");
  if (denied) return denied;

  const sp = req.nextUrl.searchParams;
  const date = sp.get("date") ?? "";
  const duration = Number(sp.get("duration") ?? "");
  const therapyIds = (sp.get("therapyIds") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ ok: false, error: "Give the date as YYYY-MM-DD." }, { status: 400 });
  }
  if (!Number.isInteger(duration) || duration <= 0 || duration > MAX_DURATION) {
    return NextResponse.json({ ok: false, error: "Give the length in whole minutes." }, { status: 400 });
  }

  const win = dayWindow(date);
  const closed = win.closed || blocksCoverDay(win.open, win.close, blockOutsForDate(date));
  const slots = closed
    ? []
    : slotCandidates(win.open, win.close, duration, BOOKING_STEP_MINUTES).map((time) => {
        const check = checkBookingSlot(date, time, duration, therapyIds);
        return check.ok ? { time, free: true } : { time, free: false, reason: check.reason ?? "Taken." };
      });

  return NextResponse.json({
    ok: true,
    date,
    closed,
    open: win.open,
    close: win.close,
    stepMinutes: BOOKING_STEP_MINUTES,
    slots,
    // The booking screen shows a reminder when this week's rota is empty.
    rota: { unfilled: weekUnfilled(date), week: mondayOf(date) },
  });
}
