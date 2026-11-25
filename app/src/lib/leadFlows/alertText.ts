/** The wording of the staff alerts, as agreed. Pure. */

/** The first `max` characters of a message, whitespace tidied. */
export function firstChars(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : flat.slice(0, max).trimEnd();
}

export function newLeadAlertText(a: { name: string; source: string; phone: string | null; link: string }): string {
  return `New lead: ${a.name}, ${a.source}. ${a.phone || "No phone"}. Open: ${a.link}`;
}

export function hotLeadAlertText(a: { name: string; reply: string | null; link: string }): string {
  const reply = a.reply?.trim();
  return reply ? `Hot lead: ${a.name} replied: "${firstChars(reply)}". Open: ${a.link}` : `Hot lead: ${a.name} replied. Open: ${a.link}`;
}

export function callBackAlertText(a: { name: string; phone: string | null; link: string }): string {
  return `Call back today: ${a.name}, ${a.phone || "no phone"}. Open: ${a.link}`;
}
