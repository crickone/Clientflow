import { createHash } from "node:crypto";

/**
 * Meta Conversions API: the pure parts (normalising, hashing, building an
 * event, retry timing). The queue and the sending are lib/facebook/capi.ts.
 *
 * Meta requires personal data (email, phone, name, town, country, our own
 * ids) to be normalised then SHA-256 hashed before it leaves us; IP address,
 * browser, and Meta's own _fbp/_fbc cookie values are sent as they are.
 * https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
 */

/** Set in the visitor's browser by SiteTracking when they accept advertising cookies. */
export { ADS_CONSENT_COOKIE } from "./consentCookie";

export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export function normEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/**
 * Digits with the country code and no leading zeros or plus. A number written
 * the Irish way (083 867 2844) is given +353, since every business on the
 * platform is in Ireland; one already international (+44..., 0044...) keeps
 * its own code.
 */
export function normPhone(raw: string | null | undefined): string | null {
  let d = (raw ?? "").replace(/[^\d+]/g, "");
  if (!d) return null;
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = `353${d.slice(1)}`;
  d = d.replace(/\D/g, "");
  return d.length >= 8 && d.length <= 15 ? d : null;
}

export function normName(raw: string | null | undefined): string | null {
  const n = (raw ?? "").trim().toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{M}' -]/gu, "").trim();
  return n || null;
}

export interface AdContext {
  /** The visitor accepted advertising cookies on this site. */
  consent: boolean;
  fbp: string | null;
  fbc: string | null;
  ip: string | null;
  userAgent: string | null;
  /** The page the event happened on. */
  url: string | null;
}

export interface Person {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** Our own id for them (e.g. "lead-12"), hashed. */
  externalId?: string | null;
}

/** Meta's user_data: personal fields hashed, browser fields as they are. Empty fields left out. */
export function userData(person: Person, ctx: Partial<AdContext> | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const em = normEmail(person.email);
  const ph = normPhone(person.phone);
  const fn = normName(person.firstName);
  const ln = normName(person.lastName);
  if (em) out.em = [sha256(em)];
  if (ph) out.ph = [sha256(ph)];
  if (fn) out.fn = [sha256(fn)];
  if (ln) out.ln = [sha256(ln)];
  if (person.externalId) out.external_id = [sha256(person.externalId)];
  out.country = [sha256("ie")];
  if (ctx?.ip) out.client_ip_address = ctx.ip;
  if (ctx?.userAgent) out.client_user_agent = ctx.userAgent;
  if (ctx?.fbp) out.fbp = ctx.fbp;
  if (ctx?.fbc) out.fbc = ctx.fbc;
  return out;
}

export interface CapiEvent {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: "website" | "system_generated";
  event_source_url?: string;
  user_data: Record<string, unknown>;
  custom_data?: Record<string, unknown>;
}

/** A website event (Lead, Purchase) from a visitor who accepted advertising cookies. */
export function websiteEvent(opts: {
  name: "Lead" | "Purchase" | "ViewContent" | "InitiateCheckout";
  eventId: string;
  person: Person;
  ctx: AdContext;
  custom?: Record<string, unknown>;
  at?: number;
}): CapiEvent {
  return {
    event_name: opts.name,
    event_time: Math.floor((opts.at ?? Date.now()) / 1000),
    event_id: opts.eventId,
    action_source: "website",
    ...(opts.ctx.url ? { event_source_url: opts.ctx.url } : {}),
    user_data: userData(opts.person, opts.ctx),
    ...(opts.custom ? { custom_data: opts.custom } : {}),
  };
}

/**
 * A lead-ads lead moving on in the pipeline ("conversion leads"): Meta learns
 * which of its leads booked or bought, so lead ads find more people like
 * them. Identified by Meta's own lead id only.
 */
export function crmEvent(opts: { stageName: string; leadgenId: string; at?: number }): CapiEvent | null {
  if (!/^\d{5,20}$/.test(opts.leadgenId)) return null;
  return {
    event_name: opts.stageName.slice(0, 50),
    event_time: Math.floor((opts.at ?? Date.now()) / 1000),
    event_id: `crm-${opts.leadgenId}-${opts.stageName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    action_source: "system_generated",
    user_data: { lead_id: Number(opts.leadgenId) },
    custom_data: { event_source: "crm", lead_event_source: "AdonisAgent" },
  };
}

/** Pipeline roles worth telling Meta about, with the event name each sends. */
export const CRM_STAGE_EVENTS: Record<string, string> = {
  booked: "Booked",
  attended: "Attended",
  won: "Converted",
  repeat: "Repeat customer",
};

/** Retry timing for an event Meta did not take. Meta accepts events up to 7 days old; we stop at a day. */
const STEPS_MIN = [1, 5, 15, 60] as const;
export const CAPI_GIVE_UP_MS = 24 * 60 * 60 * 1000;
export function capiRetryDelayMs(failedAttempts: number): number {
  return STEPS_MIN[Math.max(0, Math.min(failedAttempts - 1, STEPS_MIN.length - 1))] * 60_000;
}

/** Read a cookie from a Cookie header. */
export function cookieValue(header: string | null | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) {
      try {
        return decodeURIComponent(v.join("=")) || null;
      } catch {
        return v.join("=") || null;
      }
    }
  }
  return null;
}

/** Meta's browser cookies look like fb.1.<time>.<value>; anything else is not sent. */
export const isMetaCookie = (v: string | null): v is string => Boolean(v && /^fb\.\d\.\d{10,13}\.[\w-]{1,200}$/.test(v));
