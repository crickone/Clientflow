/**
 * The bespoke-site enquiry form's fields, validated once, here, for both the
 * JSON and the url-encoded path of POST /api/site/enquiry. Pure: no DB, no
 * request object. Mirrors lib/campaigns/signup.ts's shape and caps.
 */
import { PUBLIC_FORM_HONEYPOT_FIELD } from "@/lib/publicFormExchange";

/**
 * A bespoke site's enquiry form offers that site's own programmes. The sets
 * live here rather than in each site's markup because the server has to refuse
 * a programme the form could not have offered -- a check the form itself
 * cannot be trusted to have made. Every set carries "unsure", which is what a
 * submission with no programme at all falls back to.
 */
const SITE_PROGRAMMES: Record<string, Record<string, string>> = {
  healthwise: {
    livewell: "Livewell 40–60",
    studio60: "Studio 60",
    heartwise: "Heartwise",
    unsure: "Not sure yet",
  },
  "optimal-health": {
    hbot: "Hyperbaric oxygen",
    infrared: "Infrared",
    hifem: "HIFEM chair",
    massage: "Massage and bodywork",
    unsure: "Not sure yet",
  },
};

/** A site with no set of its own offers the one option that names no programme. */
const NEUTRAL: Record<string, string> = { unsure: "Not sure yet" };

/**
 * The slug every caller that predates per-site programmes means. Healthwise is
 * the site this module was written for and the only one posting to it when the
 * slug was added, so the default keeps that path byte-for-byte as it was.
 */
const DEFAULT_SITE = "healthwise";

/** The programme values `slug`'s form may offer, in the order it should offer them. */
export function programmesForSite(slug: string): readonly string[] {
  return Object.keys(SITE_PROGRAMMES[slug] ?? NEUTRAL);
}

/** What the operator reads on the lead card, or the raw value when the site does not offer it. */
export function programmeLabel(slug: string, programme: string): string {
  return (SITE_PROGRAMMES[slug] ?? NEUTRAL)[programme] ?? programme;
}

/** The two public forms (this one and f/[slug]/submit) share one honeypot field name. */
export const ENQUIRY_HONEYPOT_FIELD = PUBLIC_FORM_HONEYPOT_FIELD;

export interface ValidEnquiry {
  name: string;
  email: string | null;
  phone: string | null;
  /** One of `programmesForSite(slug)` for the site the submission came from. */
  programme: string;
  about: string | null;
}

export type ValidateEnquiryResult = { ok: true; data: ValidEnquiry } | { ok: false; error: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_NAME = 120;
const MAX_EMAIL = 200;
const MAX_PHONE = 60;
const MAX_ABOUT = 1000;

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function isEnquiryHoneypotTripped(fields: Record<string, string>): boolean {
  return asString(fields[ENQUIRY_HONEYPOT_FIELD]).length > 0;
}

export function validateEnquiry(
  fields: Record<string, string>,
  slug: string = DEFAULT_SITE,
): ValidateEnquiryResult {
  const name = asString(fields.name);
  if (!name) return { ok: false, error: "Please enter your name." };
  if (name.length > MAX_NAME) return { ok: false, error: "That name is too long." };

  const email = asString(fields.email);
  if (email.length > MAX_EMAIL) return { ok: false, error: "That email address is too long." };
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: "Please check the email address." };

  const phone = asString(fields.phone);
  if (phone.length > MAX_PHONE) return { ok: false, error: "That phone number is too long." };
  if (!email && !phone) return { ok: false, error: "Please give a phone number or an email address so we can reply." };

  // A submission with no programme at all still lands -- the enquiry is the
  // point, not the dropdown -- but a programme this site's form could not have
  // offered is refused rather than quietly rewritten into something else.
  const rawProgramme = asString(fields.programme);
  const allowed = programmesForSite(slug);
  const programme = rawProgramme === "" ? "unsure" : allowed.includes(rawProgramme) ? rawProgramme : null;
  if (programme === null) return { ok: false, error: "Please choose one of the options." };

  const about = asString(fields.about);
  if (about.length > MAX_ABOUT) return { ok: false, error: "Please keep the message under 1000 characters." };

  return {
    ok: true,
    data: { name, email: email || null, phone: phone || null, programme, about: about || null },
  };
}

/**
 * The no-JS fallback bounces back to the page the form was on. That path is
 * client input, so it is accepted only as a root-relative path: no scheme, no
 * protocol-relative "//host", no backslash tricks, query and hash dropped.
 * Any control character (tab, LF, CR, ...) is rejected outright too, since
 * `new URL()` strips them before parsing and one could otherwise smuggle a
 * protocol-relative "//host" past the startsWith("//") guard.
 */
export function safeReturnPath(v: unknown, fallback = "/contact"): string {
  const s = asString(v);
  if (/[\x00-\x1f\x7f]/.test(s)) return fallback;
  if (!s.startsWith("/") || s.startsWith("//") || s.includes("\\")) return fallback;
  const bare = s.split("?")[0]!.split("#")[0]!;
  return bare || fallback;
}

/**
 * The path of a same-origin Referer, or null. A plain form post carries the
 * page it came from in Referer; that is the right place to send the no-JS
 * visitor back to, on whichever host or mount the site is served from.
 */
export function sameOriginRefererPath(referer: string | null, requestUrl: string): string | null {
  if (!referer) return null;
  try {
    const ref = new URL(referer);
    const req = new URL(requestUrl);
    if (ref.origin !== req.origin) return null;
    return ref.pathname;
  } catch {
    return null;
  }
}

/** The lead's notes: what the operator sees on the card, in the site's own words. */
export function enquiryNotes(d: ValidEnquiry, slug: string = DEFAULT_SITE): string {
  const lines = [`Programme: ${programmeLabel(slug, d.programme)}`];
  if (d.about) lines.push(`About: ${d.about}`);
  return lines.join("\n");
}
