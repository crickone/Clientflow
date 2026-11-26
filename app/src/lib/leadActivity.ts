import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { describeArrival, parseArrival } from "@/lib/arrival";
import { bookedByPackage } from "@/lib/packageBalance";
import { sessionsLeft } from "@/lib/packageBalanceModel";
import { CALL_OUTCOMES, formatCallDay, formatCallTime } from "@/lib/leadFlows/callPlan";
import { zonedTimeToUtc } from "@/lib/leadFlows/sendingWindow";
import type { Lead } from "@/lib/db/schema";
import { paymentLabel, withoutAdNumber, type ActivityEvent } from "./leadActivityModel";

/**
 * What the lead page's activity feed and Purchases card show, read once on
 * the server. Messages are not here: the page holds them in state. See
 * leadActivityModel.ts for how the two are merged.
 */

export interface LeadPurchase {
  id: number;
  name: string;
  pricePaidEur: number;
  totalSessions: number;
  sessionsLeft: number;
  expiryDate: string;
}

export interface LeadActivity {
  events: ActivityEvent[];
  purchases: LeadPurchase[];
  /** Sum of the client's payments, in euro. Null when the lead is not a client. */
  paidEur: number | null;
}

const eur = (n: number) => `€${Number.isInteger(n) ? n : n.toFixed(2)}`;
const SOURCE: Record<string, string> = {
  offer: "Bought online",
  landing: "Signed up on a campaign page",
  website: "Enquired on the website",
  facebook: "Came in from a Facebook lead form",
  meta: "Came in from a Facebook lead form",
  whatsapp: "Messaged on WhatsApp",
  manual: "Added by the team",
  voice: "Came in by phone",
  gohighlevel: "Imported from GoHighLevel",
  checkout: "Started an online checkout",
};
const ACTOR: Record<string, string> = { user: "By the team", agent: "By Adonis", automation: "By a follow-up flow", system: "Automatically" };
const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", email: "email", push: "app alert", chat: "chat" };

export function leadActivity(lead: Lead): LeadActivity {
  const events: ActivityEvent[] = [];
  const created = lead.createdAt.getTime();

  const arrival = parseArrival(lead.arrival);
  if (arrival?.at && arrival.at < created - 60_000) {
    events.push({ key: "arrived", kind: "arrived", at: arrival.at, title: `Visited from ${withoutAdNumber(describeArrival(arrival))}`, detail: arrival.landing ?? null });
  }
  // An online purchase that made the lead: the purchase rows say it already.
  if (!(lead.source === "offer" && lead.clientId)) events.push({
    key: "came-in",
    kind: "came_in",
    at: created,
    title: SOURCE[lead.source] ?? "Came in",
    detail: [lead.campaign, arrival ? `from ${withoutAdNumber(describeArrival(arrival))}` : null].filter(Boolean).join(", ") || null,
  });

  // Stage moves, by name.
  const moves = db.select().from(schema.leadStageEvents).where(eq(schema.leadStageEvents.leadId, lead.id)).orderBy(asc(schema.leadStageEvents.at)).all();
  if (moves.length > 0) {
    const ids = [...new Set(moves.map((m) => m.toStageId))];
    const names = new Map(db.select({ id: schema.pipelineStages.id, name: schema.pipelineStages.name }).from(schema.pipelineStages).where(inArray(schema.pipelineStages.id, ids)).all().map((s) => [s.id, s.name]));
    for (const m of moves) {
      const name = names.get(m.toStageId);
      if (!name) continue;
      events.push({ key: `stage-${m.id}`, kind: "stage", at: m.at.getTime(), title: `Moved to ${name}`, detail: ACTOR[m.actor] ?? null });
    }
  }

  // Calls logged and booked.
  for (const c of db.select().from(schema.leadCalls).where(eq(schema.leadCalls.leadId, lead.id)).orderBy(desc(schema.leadCalls.createdAt)).limit(50).all()) {
    const at = c.createdAt;
    let title: string;
    if (c.scheduledFor != null) {
      const when = c.scheduledFor;
      title = `Call booked for ${formatCallDay(when)} at ${formatCallTime(when)}`;
    } else if (c.scheduledDay) title = `Call back on ${formatCallDay(zonedTimeToUtc(c.scheduledDay, "12:00"))}`;
    else title = `Call logged: ${CALL_OUTCOMES.find((o) => o.key === c.outcome)?.label ?? "no outcome"}`;
    events.push({ key: `call-${c.id}`, kind: "call", at, title, detail: c.note ?? null });
  }

  // What the follow-up flows sent (or failed to send). They are not lead messages.
  const sent = db
    .select()
    .from(schema.automationQueue)
    .where(and(eq(schema.automationQueue.leadId, lead.id), eq(schema.automationQueue.kind, "message"), inArray(schema.automationQueue.status, ["sent", "failed"])))
    .all();
  for (const q of sent) {
    const at = (q.sentAt ?? q.dueAt).getTime();
    const ch = CHANNEL[q.channel] ?? q.channel;
    const failed = q.status === "failed";
    const body = (q.subject ? `${q.subject}: ` : "") + q.body.replace(/\s+/g, " ").trim();
    events.push({
      key: `flow-${q.id}`,
      kind: "flow_message",
      at,
      title: failed ? `Follow-up ${ch} did not send` : `Follow-up ${ch} sent`,
      detail: failed ? (q.error ?? null) : body.length > 160 ? `${body.slice(0, 157)}...` : body,
      failed,
    });
  }

  // Purchases: the client's payments and their active packages.
  let purchases: LeadPurchase[] = [];
  let paidEur: number | null = null;
  if (lead.clientId) {
    const pays = db.select().from(schema.payments).where(eq(schema.payments.clientId, lead.clientId)).all();
    const pkgs = db.select().from(schema.packages).where(eq(schema.packages.clientId, lead.clientId)).orderBy(desc(schema.packages.id)).all();
    const pkgName = new Map(pkgs.map((p) => [p.id, p.packageName]));
    paidEur = Math.round(pays.reduce((s, p) => s + p.amountEur, 0) * 100) / 100;
    for (const p of pays) {
      if (p.amountEur <= 0) continue;
      const label = paymentLabel(p.notes, p.packageId ? pkgName.get(p.packageId) : null);
      events.push({
        key: `pay-${p.id}`,
        kind: "purchase",
        at: p.createdAt.getTime(),
        title: label ? `Bought ${label}, ${eur(p.amountEur)}` : `Paid ${eur(p.amountEur)}`,
        detail: /^online:/i.test(p.notes ?? "") ? "Paid online" : null,
      });
    }
    const active = pkgs.filter((p) => p.isActive && p.planType !== "recurring_membership");
    const booked = bookedByPackage(active.map((p) => p.id));
    purchases = active.map((p) => ({
      id: p.id,
      name: p.packageName,
      pricePaidEur: p.pricePaidEur,
      totalSessions: p.totalSessions,
      sessionsLeft: sessionsLeft(p, booked.get(p.id) ?? 0),
      expiryDate: p.expiryDate,
    }));
  }

  return { events, purchases, paidEur };
}
