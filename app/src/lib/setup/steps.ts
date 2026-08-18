import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCurrentTenant } from "@/lib/db/tenant";
import { controlSqlite } from "@/lib/db/control";
import { readKey, setKey, getBrandingLogoFilename, getVenueType, getSchedulingMode } from "@/lib/settings";
import { getBusinessProfile, isBriefComplete } from "@/lib/businessProfile";
import { isEmailConfigured } from "@/lib/email";
import { isWhatsAppConfigured } from "@/lib/whatsapp/config";
import { listFacebookPages } from "@/lib/facebook/pages";
import { getSendingDomain } from "@/lib/marketing/domains";
import { getVocab, type Vocab } from "@/lib/vocabulary";

export type SetupGroup = "foundation" | "channels" | "data";
export type SetupAction =
  | { kind: "link"; href: string; secondaryHref?: string }
  | { kind: "inline-business" }
  | { kind: "ack-venue" };
export interface SetupStepDef {
  id: string; group: SetupGroup; title: string; blurb: string;
  agencyNote?: string; optional?: boolean; action: SetupAction;
  labelKey?: "services" | "members";
}
export interface SetupStepStatus extends SetupStepDef { done: boolean; skipped: boolean }
export interface SetupSummary {
  steps: SetupStepStatus[];
  requiredDone: number; requiredTotal: number; resolved: number; total: number;
  allResolved: boolean; nextHref: string | null;
}

export const SETUP_STEPS: SetupStepDef[] = [
  { id: "business", group: "foundation", title: "Business essentials",
    blurb: "Your name, contact details and website — shown across the app and used in AI content.",
    action: { kind: "inline-business" } },
  { id: "venue", group: "foundation", title: "Venue type & scheduling",
    blurb: "Tell us whether you run a clinic or a gym, and how you schedule.",
    action: { kind: "ack-venue" } },
  { id: "ai_context", group: "foundation", title: "Teach the AI your business",
    blurb: "A brief (and optional Marketing Brain) so generated content, images and replies sound like you.",
    action: { kind: "link", href: "/settings/business" } },
  { id: "branding", group: "foundation", title: "Logo & appearance",
    blurb: "Upload your logo (used on posts, cards and the app) and set your theme.",
    action: { kind: "link", href: "/settings/branding", secondaryHref: "/settings/appearance" } },
  { id: "services", group: "foundation", title: "Services", labelKey: "services",
    blurb: "Add what you offer so it can be booked, sold and written about.",
    action: { kind: "link", href: "/settings/therapies" } },
  { id: "email", group: "channels", title: "Connect email",
    blurb: "Send from your own address — connect Gmail or your verified domain.",
    action: { kind: "link", href: "/settings/email" } },
  { id: "whatsapp", group: "channels", title: "WhatsApp", optional: true,
    blurb: "Message leads and clients from a connected WhatsApp number.",
    action: { kind: "link", href: "/settings/integrations/whatsapp" } },
  { id: "facebook", group: "channels", title: "Facebook Lead Ads", optional: true,
    blurb: "Pull Lead Ads leads in automatically once your Page is connected.",
    agencyNote: "Client Pages need our Meta app approved — your account manager connects this with you.",
    action: { kind: "link", href: "/settings/integrations/facebook" } },
  { id: "domain", group: "channels", title: "Campaign sending domain", optional: true,
    blurb: "Verify a domain to send bulk email campaigns at scale.",
    agencyNote: "Agency-managed — only needed for bulk email marketing.",
    action: { kind: "link", href: "/campaigns/domains" } },
  { id: "clients", group: "data", title: "Import your clients", labelKey: "members",
    blurb: "Bring your existing list in from a CSV (Mindbody, Glofox, TeamUp…), or add one by hand.",
    action: { kind: "link", href: "/clients/import", secondaryHref: "/clients/new" } },
  { id: "team", group: "data", title: "Invite your team", optional: true,
    blurb: "Add staff and admin accounts so your team can log in.",
    action: { kind: "link", href: "/settings/users" } },
];

/** PURE: apply detections + skips to the defs, compute counts / allResolved / nextHref. */
export function summarizeSetup(
  defs: SetupStepDef[], detections: Record<string, boolean>, skips: Record<string, boolean>, vocab: Vocab,
): SetupSummary {
  const steps: SetupStepStatus[] = defs.map((d) => ({
    ...d,
    title: d.labelKey === "services" ? vocab.services
         : d.labelKey === "members" ? `Import your ${vocab.members}`
         : d.title,
    done: detections[d.id] === true,
    skipped: !detections[d.id] && skips[d.id] === true,
  }));
  const required = steps.filter((s) => !s.optional);
  const requiredDone = required.filter((s) => s.done).length;
  const resolved = steps.filter((s) => s.done || s.skipped).length;
  const firstUnresolved = steps.find((s) => !s.done && !s.skipped);
  const nextHref = firstUnresolved
    ? (firstUnresolved.action.kind === "link" ? firstUnresolved.action.href : "/setup")
    : null;
  return {
    steps,
    requiredDone, requiredTotal: required.length,
    resolved, total: steps.length,
    allResolved: firstUnresolved === undefined,
    nextHref,
  };
}

function serviceCount(): number {
  return db.select({ id: schema.therapies.id }).from(schema.therapies).all().length;
}
function clientCount(): number {
  return db.select({ id: schema.clients.id }).from(schema.clients).all().length;
}
function membershipCount(tenantId: number): number {
  const row = controlSqlite.prepare("SELECT COUNT(*) c FROM memberships WHERE tenant_id = ?").get(tenantId) as { c: number };
  return row.c;
}

/** WIRES live detections for the current tenant → summarizeSetup. */
export function getSetupSummary(): SetupSummary {
  const tenantId = getCurrentTenant().id;
  const p = getBusinessProfile();
  const detections: Record<string, boolean> = {
    business: p.businessName.trim().length > 0 && (p.phone.trim().length > 0 || p.location.trim().length > 0),
    venue: readKey<boolean>("setup_ack_venue", false) === true,
    ai_context: isBriefComplete() || p.marketingBrain.trim().length > 0,
    branding: getBrandingLogoFilename() !== null,
    services: serviceCount() > 0,
    email: isEmailConfigured(),
    whatsapp: isWhatsAppConfigured(),
    facebook: listFacebookPages(tenantId).length > 0,
    domain: getSendingDomain(tenantId)?.state === "verified",
    clients: clientCount() > 0,
    team: membershipCount(tenantId) > 1,
  };
  const skips: Record<string, boolean> = Object.fromEntries(
    SETUP_STEPS.filter((s) => s.optional).map((s) => [s.id, readKey<boolean>(`setup_skip_${s.id}`, false) === true]),
  );
  return summarizeSetup(SETUP_STEPS, detections, skips, getVocab(getVenueType()));
}

export function isSetupDismissed(): boolean { return readKey<boolean>("setup_complete", false) === true; }
export function setSetupDismissed(v: boolean): void { setKey("setup_complete", v); }
export function ackVenue(): void { setKey("setup_ack_venue", true); }
export function skipStep(id: string): void {
  const step = SETUP_STEPS.find((s) => s.id === id);
  if (!step || !step.optional) throw new Error("Only optional steps can be skipped.");
  setKey(`setup_skip_${id}`, true);
}
