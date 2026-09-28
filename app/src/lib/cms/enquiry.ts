/**
 * The bespoke-site enquiry form's fields, validated once, here, for both the
 * JSON and the url-encoded path of POST /api/site/enquiry. Pure: no DB, no
 * request object. Mirrors lib/campaigns/signup.ts's shape and caps.
 */
export const ENQUIRY_PROGRAMMES = ["livewell", "vitality", "heartwise", "unsure"] as const;
export type EnquiryProgramme = (typeof ENQUIRY_PROGRAMMES)[number];

const PROGRAMME_LABEL: Record<EnquiryProgramme, string> = {
  livewell: "Livewell 40–60",
  vitality: "Vitality 60+",
  heartwise: "Heartwise",
  unsure: "Not sure yet",
};

export const ENQUIRY_HONEYPOT_FIELD = "company_website";

export interface ValidEnquiry {
  name: string;
  email: string | null;
  phone: string | null;
  programme: EnquiryProgramme;
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

export function validateEnquiry(fields: Record<string, string>): ValidateEnquiryResult {
  const name = asString(fields.name);
  if (!name) return { ok: false, error: "Please enter your name." };
  if (name.length > MAX_NAME) return { ok: false, error: "That name is too long." };

  const email = asString(fields.email);
  if (email.length > MAX_EMAIL) return { ok: false, error: "That email address is too long." };
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: "Please check the email address." };

  const phone = asString(fields.phone);
  if (phone.length > MAX_PHONE) return { ok: false, error: "That phone number is too long." };
  if (!email && !phone) return { ok: false, error: "Please give a phone number or an email address so we can reply." };

  const rawProgramme = asString(fields.programme);
  const programme: EnquiryProgramme = (ENQUIRY_PROGRAMMES as readonly string[]).includes(rawProgramme)
    ? (rawProgramme as EnquiryProgramme)
    : "unsure";

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
 */
export function safeReturnPath(v: unknown, fallback = "/contact"): string {
  const s = asString(v);
  if (!s.startsWith("/") || s.startsWith("//") || s.includes("\\")) return fallback;
  const bare = s.split("?")[0]!.split("#")[0]!;
  return bare || fallback;
}

/** The lead's notes: what the operator sees on the card. */
export function enquiryNotes(d: ValidEnquiry): string {
  const lines = [`Programme: ${PROGRAMME_LABEL[d.programme]}`];
  if (d.about) lines.push(`About: ${d.about}`);
  return lines.join("\n");
}
