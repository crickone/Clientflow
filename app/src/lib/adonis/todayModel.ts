/**
 * The "Needs you today" panel on the /adonis opening screen, as pure rules
 * (lib/adonis/today.ts reads the rows). Irish time throughout.
 */

import { dublinDay } from "@/lib/cashModel";
import { dublinToMs } from "@/lib/remindersModel";

export type TodayCounts = {
  /** Lead conversations (WhatsApp, Messenger, Instagram) whose latest message came in. */
  leadsWaiting: number;
  /** Conversations whose latest inbound message has an AI draft waiting (drafted or held). */
  draftsToApprove: number;
  /** Paid offer and voucher orders since Monday; null for staff who are not admins. */
  salesCents: number | null;
  salesCount: number | null;
};

/** Monday 00:00 in Dublin, for the week `now` is in. */
export function weekStartDublin(now: number): number {
  const [y, m, d] = dublinDay(now).split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 is Sunday
  const back = (dow + 6) % 7;
  const monday = new Date(Date.UTC(y, m - 1, d - back)).toISOString().slice(0, 10);
  return dublinToMs(monday, "00:00");
}

export function countInbox(rows: { kind: "lead" | "client"; lastDirection: string; needsAttention: boolean }[]): {
  leadsWaiting: number;
  draftsToApprove: number;
} {
  return {
    leadsWaiting: rows.filter((r) => r.kind === "lead" && r.lastDirection === "inbound").length,
    draftsToApprove: rows.filter((r) => r.needsAttention).length,
  };
}

export function formatEuros(cents: number): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}
