import "server-only";

import { db } from "@/lib/db";
import { therapies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSettings, getVenueType } from "@/lib/settings";
import { getBusinessProfile } from "@/lib/businessProfile";
import type { VenueType } from "@/lib/vocabulary";

/**
 * Shared, venue-aware prompt header for the Content Studio generators
 * (draftBlog, generateCarousel, planCut, refreshSlides). It supplies the business
 * identity (from the editable Business Profile), the real list of services from
 * the DB, and a voice block chosen by venue type — so the SAME generators produce
 * business-specific, clinic- or gym-appropriate copy.
 */

const VENUE_VOICE: Record<VenueType, string> = {
  clinic: `Voice & rules:
- Irish English (analyse, organise, behaviour) — never American spellings.
- Grounded, informative, and human. Short paragraphs, varied sentence length.
- NEVER promise therapeutic outcomes or cures. Describe what a service *is*, not
  what it *does to disease*. Use phrasing like "many clients find…", "research
  suggests…", "people often visit us when they're…".
- Avoid hype words ("revolutionary", "miracle", "unlock", "game-changer").
- Keep calls to action understated — an invitation, not a hard sell.`,
  gym: `Voice & rules:
- Irish English (analyse, organise, behaviour) — never American spellings.
- Energetic and motivational, but real — speak to results, consistency, and the
  community/atmosphere. Short, punchy paragraphs.
- Encourage without over-promising: no guaranteed results, no body-shaming, no
  fake medical claims. Describe what a session/class *is* and how it *feels*.
- Avoid hype words ("revolutionary", "miracle", "unlock", "game-changer").
- Use confident, action-led calls to action ("book your first class", "come and
  try it").`,
};

/** The business identity line, composed from the editable Business Profile. */
export function getBusinessName(): string {
  const p = getBusinessProfile();
  const head = [p.businessName, p.tagline].filter(Boolean).join(", ");
  const where = p.location ? ` at ${p.location}` : "";
  const contact = [p.website, p.phone].filter(Boolean).join(" / ");
  const tail = contact ? ` (${contact})` : "";
  return `${head}${where}${tail}`;
}

/** Active services as bullet lines, built from the DB (not hardcoded). */
function formatServices(): string {
  const rows = db
    .select()
    .from(therapies)
    .where(eq(therapies.isActive, true))
    .all();

  if (rows.length === 0) {
    return "(No services are currently configured.)";
  }

  const lines = rows.map((t) => {
    const meta = `${t.defaultDurationMinutes} minutes, €${t.defaultPriceEur}`;
    const desc = t.description ? ` — ${t.description}` : "";
    return `- ${t.name} (${meta})${desc}`;
  });

  return (
    lines.join("\n") +
    "\n\nThese are the ONLY services offered. Do not invent or mention services " +
    "not in this list."
  );
}

/**
 * Just the services list — for generators (e.g. the B-roll planner) that need
 * the service context but not the copywriter role or voice rules.
 */
export function getServicesList(): string {
  return formatServices();
}

/**
 * The composed system-prompt header: identity + services + venue voice.
 * Generators prepend this to their own format/structure rules.
 */
export function getBusinessContext(): string {
  const profile = getBusinessProfile();
  const venueType = getVenueType();

  const parts: string[] = [
    `You are a copywriter for ${getBusinessName()}.`,
    "",
    "Services offered:",
    formatServices(),
  ];

  if (profile.brief.trim()) {
    parts.push("", "About the business:", profile.brief.trim());
  }

  // The "marketing brain", when set, is the authoritative directive for tone and
  // subject matter — it overrides the generic venue voice so each account (gym,
  // clinic, …) generates on-brand, on-topic content. Falls back to the built-in
  // venue voice when no brain has been written.
  const brain = profile.marketingBrain.trim();
  if (brain) {
    parts.push(
      "",
      "Marketing brain — follow these instructions for tone, subject matter and content; they take priority over any default voice:",
      brain,
    );
  } else {
    parts.push("", VENUE_VOICE[venueType]);
  }

  if (profile.voiceNotes.trim()) {
    parts.push("", `Additional tone notes: ${profile.voiceNotes.trim()}`);
  }

  return parts.join("\n");
}

const DOW = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Opening hours as readable lines, from clinic settings (Mon→Sun). */
export function formatOpeningHours(): string {
  const { openingHours } = getSettings();
  const byDow = new Map(openingHours.map((h) => [h.dow, h]));
  const fmt = (d: number) => {
    const h = byDow.get(d);
    const open = h && !h.closed && h.open && h.close;
    return `- ${DOW[d]}: ${open ? `${h!.open}–${h!.close}` : "closed"}`;
  };
  return [1, 2, 3, 4, 5, 6, 0].map(fmt).join("\n");
}

/**
 * Factual business grounding for the AI inbox (triage + FAQ auto-replies):
 * identity, services with prices, opening hours, policies, and key FAQs — all
 * from the editable Business Profile + DB. The triage engine treats this as the
 * ONLY source of truth; if a question can't be answered from it, confidence is
 * low and the reply is drafted, not auto-sent.
 */
export function getInboxBusinessFacts(): string {
  const p = getBusinessProfile();
  const parts: string[] = [
    `Business: ${getBusinessName()}.`,
    "",
    "Services:",
    formatServices(),
    "",
    "Opening hours:",
    formatOpeningHours(),
  ];
  if (p.brief.trim()) parts.push("", "About the business:", p.brief.trim());
  if (p.policies.trim()) parts.push("", "Policies:", p.policies.trim());
  const faqs = (p.faqs ?? []).filter((f) => f.q.trim() && f.a.trim());
  if (faqs.length > 0) {
    parts.push("", "Key FAQs:");
    for (const f of faqs) parts.push(`Q: ${f.q.trim()}\nA: ${f.a.trim()}`);
  }
  return parts.join("\n");
}
