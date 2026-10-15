/**
 * WhatsApp broadcasts: one message to every member who said yes to news and
 * offers by text or WhatsApp. Pure rules, shared by the composer, the sender
 * and the tests.
 *
 * WhatsApp runs through a linked phone (Whapi), and WhatsApp bans numbers
 * that look like spam. So a broadcast goes only to members who opted in,
 * every message tells them how to stop, it goes out a few a minute rather
 * than all at once, and never at night.
 */

export const MAX_MESSAGE = 1000;

/** Sent per minute per business. */
export const PER_TICK = 3;

/** Irish hours a broadcast may send in: 9:00 to 21:00. */
export const SEND_FROM_HOUR = 9;
export const SEND_UNTIL_HOUR = 21;

export const STOP_LINE = "Reply STOP to stop these messages.";

/** Fill in [FIRST_NAME] and [BUSINESS_NAME], and add the stop line. */
export function renderBroadcast(template: string, who: { firstName: string }, businessName: string): string {
  const body = template
    .replace(/\[FIRST_NAME\]/gi, who.firstName.trim() || "there")
    .replace(/\[BUSINESS_NAME\]/gi, businessName)
    .trim();
  return `${body}\n\n${STOP_LINE}`;
}

export function validateBroadcast(template: string): string | null {
  const t = template.trim();
  if (!t) return "Write the message first.";
  if (t.length > MAX_MESSAGE) return `Keep it under ${MAX_MESSAGE} characters.`;
  if (/\[(?!FIRST_NAME\]|BUSINESS_NAME\])[A-Z_]+\]/i.test(t)) return "Only [FIRST_NAME] and [BUSINESS_NAME] can be filled in.";
  return null;
}

/** A reply that asks to stop: STOP, Unsubscribe, Stop all, etc., on its own. */
export function isStopReply(text: string): boolean {
  return /^\s*(stop|stop all|stopall|unsubscribe|cancel|end|quit|opt out|optout)[\s.!]*$/i.test(text);
}

/** The hour (0-23) in Ireland at a moment. */
export function dublinHour(ms: number): number {
  return Number(new Date(ms).toLocaleString("en-IE", { hour: "2-digit", hour12: false, timeZone: "Europe/Dublin" }).slice(0, 2)) % 24;
}

export function inSendingHours(ms: number): boolean {
  const h = dublinHour(ms);
  return h >= SEND_FROM_HOUR && h < SEND_UNTIL_HOUR;
}

/** Roughly how long a broadcast takes, for the composer: PER_TICK a minute in sending hours. */
export function sendDuration(count: number): string {
  if (count <= 0) return "";
  const minutes = Math.ceil(count / PER_TICK);
  if (minutes < 2) return "about a minute";
  if (minutes < 60) return `about ${minutes} minutes`;
  const hours = Math.round((minutes / 60) * 2) / 2;
  return `about ${hours} hour${hours === 1 ? "" : "s"}`;
}
