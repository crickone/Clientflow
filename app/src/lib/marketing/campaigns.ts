import "server-only";

import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { contacts, emailCampaigns, type EmailCampaign } from "@/lib/db/schema";

/**
 * Email marketing — campaign CRUD + audience resolution (Task 4: campaign
 * model + builder + AI draft). Mirrors lib/marketing/domains.ts's shape in
 * one respect: `email_campaigns` has JSON-string columns (audience/stats),
 * so every read here returns a parsed CampaignRecord rather than the raw
 * Drizzle row.
 *
 * Unlike domains.ts, these functions take NO explicit tenantId and read/
 * write through the ambient, request-scoped `db` proxy instead of
 * getTenantDbById(tenantId) — every caller in this task is an authed admin
 * Server Action or a page render, both already inside a request (same
 * choice contactImport.ts's importContactsAction makes, and what this
 * task's brief specifies). A background job (e.g. the later throttled send
 * task) that needs to run outside a request should follow domains.ts's
 * explicit-tenant pattern instead, not call these directly.
 */

export type CampaignStatus = EmailCampaign["status"];

export type CampaignAudience =
  | { kind: "all_subscribed" }
  | { kind: "tag"; tag: string };

export interface CampaignRecord {
  id: number;
  name: string;
  subject: string;
  preheader: string | null;
  fromName: string;
  fromEmail: string;
  /** RAW body (plain text / light markup) — NOT the wrapped email shell. See schema.ts's comment on body_html. */
  bodyHtml: string;
  audience: CampaignAudience;
  status: CampaignStatus;
  /** Resume offset for the later throttled send (Task 5+). Always 0 until then. */
  cursor: number;
  /** JSON counts blob the later send task maintains. Always null until then. */
  stats: Record<string, unknown> | null;
  scheduledAt: number | null; // epoch ms
  sentAt: number | null; // epoch ms
  createdBy: number | null;
  createdAt: number; // epoch ms
}

/** Thrown by updateCampaign when the campaign has left the 'draft' status — it's immutable once sending has started. */
export class CampaignNotDraftError extends Error {
  constructor(status: string) {
    super(`This campaign is already "${status}" and can no longer be edited.`);
    this.name = "CampaignNotDraftError";
  }
}

// ── parsing helpers ────────────────────────────────────────────────────────

/** Parse a stored `audience` JSON string. Any malformed/unrecognized value falls back to the safe default (all subscribed) rather than throwing. */
export function parseCampaignAudience(raw: string): CampaignAudience {
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === "object") {
      const tag = (v as { tag?: unknown }).tag;
      if ((v as { kind?: unknown }).kind === "tag" && typeof tag === "string" && tag.trim()) {
        return { kind: "tag", tag };
      }
    }
  } catch {
    // fall through to the safe default below
  }
  return { kind: "all_subscribed" };
}

function parseStats(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Mirrors the safe-parse used by the contacts list page / import action — contacts.tags is a JSON string[]. */
function parseContactTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function toRecord(row: EmailCampaign): CampaignRecord {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    preheader: row.preheader,
    fromName: row.fromName,
    fromEmail: row.fromEmail,
    bodyHtml: row.bodyHtml,
    audience: parseCampaignAudience(row.audience),
    status: row.status,
    cursor: row.cursor,
    stats: parseStats(row.stats),
    scheduledAt: row.scheduledAt ? row.scheduledAt.getTime() : null,
    sentAt: row.sentAt ? row.sentAt.getTime() : null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.getTime(),
  };
}

// ── CRUD ──────────────────────────────────────────────────────────────────

export interface CampaignCreateInput {
  name: string;
  subject: string;
  preheader?: string | null;
  fromName: string;
  fromEmail: string;
  bodyHtml?: string;
  audience?: CampaignAudience;
  createdBy?: number | null;
}

/** Create a new DRAFT campaign. Body/audience default to empty/all-subscribed so a bare "name + subject" is enough to start one. */
export function createCampaign(input: CampaignCreateInput): CampaignRecord {
  const row = db
    .insert(emailCampaigns)
    .values({
      name: input.name.trim(),
      subject: input.subject.trim(),
      preheader: input.preheader?.trim() || null,
      fromName: input.fromName.trim(),
      fromEmail: input.fromEmail.trim().toLowerCase(),
      bodyHtml: input.bodyHtml ?? "",
      audience: JSON.stringify(input.audience ?? { kind: "all_subscribed" }),
      createdBy: input.createdBy ?? null,
    })
    .returning()
    .get();
  return toRecord(row);
}

export function getCampaign(id: number): CampaignRecord | null {
  const row = db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id)).get();
  return row ? toRecord(row) : null;
}

/** All campaigns, newest first. */
export function listCampaigns(): CampaignRecord[] {
  return db
    .select()
    .from(emailCampaigns)
    .orderBy(desc(emailCampaigns.createdAt))
    .all()
    .map(toRecord);
}

export interface CampaignUpdateInput {
  name?: string;
  subject?: string;
  preheader?: string | null;
  fromName?: string;
  fromEmail?: string;
  bodyHtml?: string;
  audience?: CampaignAudience;
}

/**
 * Update a campaign's compose fields. DRAFT-ONLY: throws CampaignNotDraftError
 * once a campaign has left 'draft' (sending/sent/paused/failed) — the send
 * pipeline (Task 5+) owns those transitions, and letting the composer edit a
 * campaign that's already sending/sent would be a correctness hazard, not
 * just a UX one. Throws a plain Error if the id doesn't exist.
 */
export function updateCampaign(id: number, input: CampaignUpdateInput): CampaignRecord {
  const existing = db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id)).get();
  if (!existing) throw new Error(`Campaign ${id} not found.`);
  if (existing.status !== "draft") throw new CampaignNotDraftError(existing.status);

  const patch: Partial<typeof emailCampaigns.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.subject !== undefined) patch.subject = input.subject.trim();
  if (input.preheader !== undefined) patch.preheader = input.preheader?.trim() || null;
  if (input.fromName !== undefined) patch.fromName = input.fromName.trim();
  if (input.fromEmail !== undefined) patch.fromEmail = input.fromEmail.trim().toLowerCase();
  if (input.bodyHtml !== undefined) patch.bodyHtml = input.bodyHtml;
  if (input.audience !== undefined) patch.audience = JSON.stringify(input.audience);

  db.update(emailCampaigns).set(patch).where(eq(emailCampaigns.id, id)).run();
  return getCampaign(id)!;
}

// ── audience resolution ─────────────────────────────────────────────────────

export interface AudienceResolution {
  contactIds: number[];
  emails: string[];
}

/**
 * Resolve a campaign's audience against the CURRENT `contacts` table. Never
 * denormalized/cached on the campaign row — always computed fresh, so a
 * contact that unsubscribes after a campaign is drafted is excluded next
 * time this runs (the later send task calls this again right before
 * sending, rather than trusting an earlier snapshot).
 *
 * Hard gate: only status='subscribed' contacts are ever eligible —
 * unsubscribed/bounced/complained/cleaned contacts are excluded regardless
 * of audience kind. 'tag' matches a contact whose `tags` JSON array
 * contains the campaign's tag.
 *
 * Takes just the `audience` field (Pick, not the full CampaignRecord) so
 * callers — including tests — can pass a bare `{audience: ...}` without
 * needing a fully-populated campaign row.
 */
export function resolveAudience(
  campaign: Pick<CampaignRecord, "audience">,
): AudienceResolution {
  const subscribed = db
    .select({ id: contacts.id, email: contacts.email, tags: contacts.tags })
    .from(contacts)
    .where(eq(contacts.status, "subscribed"))
    .all();

  const audience = campaign.audience;
  const matches =
    audience.kind === "all_subscribed"
      ? subscribed
      : subscribed.filter((c) => parseContactTags(c.tags).includes(audience.tag));

  return {
    contactIds: matches.map((c) => c.id),
    emails: matches.map((c) => c.email),
  };
}

/** Distinct tags across every contact (any status) — powers the audience picker's tag dropdown. */
export function listContactTags(): string[] {
  const rows = db.select({ tags: contacts.tags }).from(contacts).all();
  const set = new Set<string>();
  for (const r of rows) for (const t of parseContactTags(r.tags)) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}
