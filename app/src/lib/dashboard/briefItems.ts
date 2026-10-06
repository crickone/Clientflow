/**
 * Today's priorities on the dashboard: the AI picks and words them, this file
 * decides everything else. The model returns `kind` + two short strings; the
 * link, the button label and the icon come from KINDS, never from the model,
 * so a reply can't send anyone anywhere unexpected. Pure, so it is tested
 * without the app (briefItems.test.ts).
 */
export const BRIEF_KINDS = ["leads", "messages", "schedule", "members", "money", "campaign"] as const;
export type BriefKind = (typeof BRIEF_KINDS)[number];

export interface BriefItem {
  kind: BriefKind;
  title: string;
  detail: string;
  href: string;
  action: string;
}

export function kindLink(kind: BriefKind, mode: "timetable" | "appointments"): { href: string; action: string } {
  switch (kind) {
    case "leads":
      return { href: "/leads", action: "Follow up" };
    case "messages":
      return { href: "/communication", action: "Open inbox" };
    case "schedule":
      return mode === "timetable" ? { href: "/timetable", action: "Open timetable" } : { href: "/appointments", action: "Open diary" };
    case "members":
      return { href: "/clients", action: "View clients" };
    case "money":
      return { href: "/reports", action: "Open reports" };
    case "campaign":
      return { href: "/marketing/calendar", action: "Plan it" };
  }
}

const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** The model's reply -> at most 3 valid items, one per kind, in its order. Unparseable -> []. */
export function parseBriefItems(text: string, mode: "timetable" | "appointments"): BriefItem[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(m[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: BriefItem[] = [];
  for (const r of raw) {
    const kind = (r as { kind?: unknown })?.kind;
    if (typeof kind !== "string" || !(BRIEF_KINDS as readonly string[]).includes(kind) || seen.has(kind)) continue;
    const title = clip((r as { title?: unknown }).title, 48);
    if (!title) continue;
    seen.add(kind);
    out.push({ kind: kind as BriefKind, title, detail: clip((r as { detail?: unknown }).detail, 90), ...kindLink(kind as BriefKind, mode) });
    if (out.length === 3) break;
  }
  return out;
}
