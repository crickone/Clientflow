import "server-only";

import { claimDailyRun, controlSqlite } from "@/lib/db/control";
import { escapeHtml, sendPlatformEmail } from "@/lib/email";
import { getPlatformSetting, setPlatformSetting } from "@/lib/billing/settings";
import { dublinToday } from "@/lib/billing/dates";
import { listPlatformStaff } from "./roles";
import { listOpenAlerts, type PlatformAlertRow } from "./healthHistory";

/**
 * Tell platform staff. A `bad` alert emails the moment it opens, once. At
 * 08:00 Dublin a digest lists everything still open. Each staff member can
 * switch either off for themselves.
 */
export interface NotifyPrefs { instant: boolean; digest: boolean }

const CONSOLE_URL = process.env.CONSOLE_URL ?? "https://admin.adonisagent.ie";

export function getNotifyPrefs(userId: number): NotifyPrefs {
  try {
    const raw = getPlatformSetting(`notify:${userId}`);
    const p = raw ? (JSON.parse(raw) as Partial<NotifyPrefs>) : {};
    return { instant: p.instant !== false, digest: p.digest !== false };
  } catch {
    return { instant: true, digest: true };
  }
}

export function setNotifyPrefs(userId: number, prefs: NotifyPrefs): void {
  setPlatformSetting(`notify:${userId}`, JSON.stringify({ instant: Boolean(prefs.instant), digest: Boolean(prefs.digest) }));
}

export function shouldNotifyInstant(a: { level: "warn" | "bad"; notifiedAt: number | null; openedAt: number }, now: number): boolean {
  void now;
  return a.level === "bad" && a.notifiedAt === null;
}

function recipients(kind: keyof NotifyPrefs): string[] {
  return listPlatformStaff()
    .filter((s) => s.isActive && getNotifyPrefs(s.userId)[kind])
    .map((s) => s.email);
}

function line(a: PlatformAlertRow, baseUrl: string): string {
  const link = a.href ? `${baseUrl}${a.href}` : baseUrl;
  return `<li style="margin:0 0 8px"><a href="${escapeHtml(link)}">${escapeHtml(a.title)}</a></li>`;
}

export function digestHtml(alerts: PlatformAlertRow[], baseUrl: string): string {
  const bad = alerts.filter((a) => a.level === "bad");
  const warn = alerts.filter((a) => a.level === "warn");
  return (
    `<p style="margin:0 0 12px">${bad.length} ${bad.length === 1 ? "needs" : "need"} action, ${warn.length} to watch.</p>` +
    (bad.length ? `<p style="margin:16px 0 6px"><strong>Needs action</strong></p><ul style="padding-left:18px">${bad.map((a) => line(a, baseUrl)).join("")}</ul>` : "") +
    (warn.length ? `<p style="margin:16px 0 6px"><strong>To watch</strong></p><ul style="padding-left:18px">${warn.map((a) => line(a, baseUrl)).join("")}</ul>` : "") +
    `<p style="margin:16px 0 0"><a href="${escapeHtml(baseUrl)}/inbox">Open the inbox</a></p>`
  );
}

/** Emails each newly opened `bad` alert once. Returns how many emails went out. */
export async function sendInstantAlerts(now: number = Date.now()): Promise<number> {
  const rows = controlSqlite
    .prepare("SELECT id, level, opened_at, notified_at FROM platform_alerts WHERE resolved_at IS NULL AND level = 'bad' AND notified_at IS NULL")
    .all() as Array<{ id: number; level: "bad"; opened_at: number; notified_at: number | null }>;
  const due = rows.filter((r) => shouldNotifyInstant({ level: r.level, notifiedAt: r.notified_at, openedAt: r.opened_at }, now));
  if (due.length === 0) return 0;
  // Claim first so a second process cannot send the same alert.
  const claimed = due.filter((r) => controlSqlite.prepare("UPDATE platform_alerts SET notified_at = ? WHERE id = ? AND notified_at IS NULL").run(now, r.id).changes > 0);
  if (claimed.length === 0) return 0;
  const to = recipients("instant");
  if (to.length === 0) return 0;
  const alerts = listOpenAlerts({ includeSnoozed: true, now }).filter((a) => claimed.some((c) => c.id === a.id));
  const res = await sendPlatformEmail({
    to,
    subject: alerts.length === 1 ? `[Adonis] ${alerts[0].title}` : `[Adonis] ${alerts.length} new alerts need action`,
    html: `<ul style="padding-left:18px">${alerts.map((a) => line(a, CONSOLE_URL)).join("")}</ul><p style="margin:16px 0 0"><a href="${CONSOLE_URL}/inbox">Open the inbox</a></p>`,
  });
  if (!res.ok) {
    console.error("[notify] instant alert email failed:", res.error);
    // Release the claim so the next sync tries again.
    for (const c of claimed) controlSqlite.prepare("UPDATE platform_alerts SET notified_at = NULL WHERE id = ?").run(c.id);
    return 0;
  }
  return 1;
}

/** Once per Dublin day, at or after 08:00, when anything is open. */
export async function sendDailyDigest(now: number = Date.now()): Promise<boolean> {
  const dublinHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", hourCycle: "h23" }).format(new Date(now)));
  if (dublinHour < 8) return false;
  const today = dublinToday(new Date(now));
  const alerts = listOpenAlerts({ now });
  if (alerts.length === 0) return false;
  if (!claimDailyRun("alert_digest_last_run", today)) return false;
  const to = recipients("digest");
  if (to.length === 0) return false;
  const res = await sendPlatformEmail({ to, subject: `[Adonis] Morning: ${alerts.length} open ${alerts.length === 1 ? "alert" : "alerts"}`, html: digestHtml(alerts, CONSOLE_URL) });
  if (!res.ok) console.error("[notify] digest email failed:", res.error);
  return res.ok;
}
