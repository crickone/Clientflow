/**
 * How a person arrived on the website the visit they became a lead: the ad
 * or post link they clicked (utm tags, Facebook/Google click ids) or the site
 * that sent them. Read in the browser at the first page of the visit, kept
 * for that visit only (sessionStorage), and attached to the enquiry, campaign
 * sign-up or checkout they then send. Nothing about anyone who never gets in
 * touch is kept. Pure, so the browser and server share one copy.
 */

export type Arrival = {
  /** utm_source, e.g. "facebook", "instagram", "newsletter". */
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  /** A paid click: Facebook (fbclid) or Google (gclid). */
  click?: "facebook" | "google";
  /** The site that sent them, as a bare domain ("google.com"). */
  referrer?: string;
  /** The first page of the visit, e.g. "/c/black-friday-massage-2026". */
  landing?: string;
  at?: number;
};

const clean = (v: unknown, max = 80) =>
  typeof v === "string" ? v.replace(/[^\w .:/@&+-]/g, "").trim().slice(0, max) || undefined : undefined;

/** Read an Arrival from untrusted JSON (a form field or request body). Null when there's nothing in it. */
export function parseArrival(raw: unknown): Arrival | null {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const a: Arrival = {
    source: clean(o.source)?.toLowerCase(),
    medium: clean(o.medium)?.toLowerCase(),
    campaign: clean(o.campaign, 120),
    content: clean(o.content, 120),
    click: o.click === "facebook" || o.click === "google" ? o.click : undefined,
    referrer: clean(o.referrer)?.toLowerCase(),
    landing: clean(o.landing, 200),
    at: typeof o.at === "number" && Number.isFinite(o.at) ? o.at : undefined,
  };
  const has = Object.entries(a).some(([k, x]) => k !== "at" && x !== undefined);
  return has ? (JSON.parse(JSON.stringify(a)) as Arrival) : null;
}

/** Build an Arrival from the page address and referrer (the browser side). */
export function arrivalFromPage(href: string, referrer: string, now: number): Arrival | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const q = url.searchParams;
  let ref: string | undefined;
  try {
    const r = referrer ? new URL(referrer) : null;
    if (r && r.hostname.replace(/^www\./, "") !== url.hostname.replace(/^www\./, "")) ref = r.hostname.replace(/^www\./, "");
  } catch {
    ref = undefined;
  }
  return parseArrival({
    source: q.get("utm_source") ?? undefined,
    medium: q.get("utm_medium") ?? undefined,
    campaign: q.get("utm_campaign") ?? undefined,
    content: q.get("utm_content") ?? undefined,
    click: q.has("fbclid") ? "facebook" : q.has("gclid") ? "google" : undefined,
    referrer: ref,
    landing: url.pathname,
    at: now,
  });
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One line in plain words: "Facebook ad (Black Friday Massage)", "Google search", "Instagram". */
export function describeArrival(a: Arrival | null): string {
  if (!a) return "No record of how they arrived";
  const src = a.source ?? "";
  const ref = a.referrer ?? "";
  const paid = a.click !== undefined || /^(cpc|ppc|paid|paid_social|ads?)$/.test(a.medium ?? "");
  let where: string;
  if (/^(fb|facebook|meta)$/.test(src) || a.click === "facebook" || /(^|\.)facebook\.com$|^fb\.me$/.test(ref)) where = "Facebook";
  else if (/^(ig|instagram)$/.test(src) || /(^|\.)instagram\.com$/.test(ref)) where = "Instagram";
  else if (/^google$/.test(src) || a.click === "google" || /(^|\.)google\.[a-z.]+$/.test(ref)) where = "Google";
  else if (src) where = titleCase(src);
  else if (ref) where = ref;
  else where = "";
  const kind = !where ? "" : paid ? " ad" : where === "Google" && !src ? " search" : a.medium === "email" ? " email" : "";
  const label = where ? `${where}${kind}` : "Typed the address or used a saved link";
  return a.campaign ? `${label} (${a.campaign})` : label;
}
