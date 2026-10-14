import "server-only";

import { and, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  appointments,
  clientMessages,
  clients,
  leadMessages,
  leadStageEvents,
  leads,
  offerOrders,
  offers,
  packages,
  payments,
  pipelineStages,
  sessions,
  therapies,
} from "@/lib/db/schema";
import { describeArrival, parseArrival } from "@/lib/arrival";
import { isOnlinePurchasePayment, orderJourney, toMs, type JourneyEvent } from "@/lib/journeyModel";

const SOURCE_LABEL: Record<string, string> = {
  offer: "Bought online from a campaign page",
  landing: "Signed up on a campaign page",
  website: "Enquired on the website",
  facebook: "Facebook Lead Ad form",
  meta: "Facebook Lead Ad form",
  instagram: "Instagram",
  whatsapp: "WhatsApp message",
  manual: "Added by the team",
  voice: "Phone call",
};

const eur = (n: number) => `€${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;
const excerpt = (s: string, n = 110) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Ad details a lead form integration sent along (Facebook Lead Ads via Make, etc.). */
function adDetails(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const pick = (re: RegExp) => {
      for (const [k, v] of Object.entries(o)) if (re.test(k) && typeof v === "string" && v.trim()) return v.trim();
      return null;
    };
    const parts = [pick(/^campaign(_name)?$/i), pick(/^ad_?set(_name)?$/i), pick(/^ad(_name)?$/i), pick(/^form(_name)?$/i)].filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  } catch {
    return null;
  }
}

/**
 * Everything between this client and the business, oldest first: how they
 * first got in touch (and how they arrived), pipeline moves, messages,
 * online purchases, payments, packages, bookings, treatments and misses.
 * Their leads are the ones linked to them, or sharing their email or phone.
 */
export function getClientJourney(clientId: number): JourneyEvent[] {
  const client = db.select().from(clients).where(eq(clients.id, clientId)).get();
  if (!client) return [];
  const events: JourneyEvent[] = [];
  const therapyName = new Map(db.select({ id: therapies.id, name: therapies.name }).from(therapies).all().map((t) => [t.id, t.name]));

  // Leads: theirs by link, or by the same email or phone.
  const match = [eq(leads.clientId, clientId)];
  if (client.email) match.push(sql`lower(${leads.email}) = ${client.email.toLowerCase()}`);
  if (client.phone) match.push(eq(leads.phone, client.phone));
  const myLeads = db.select().from(leads).where(or(...match)).all();
  const leadIds = myLeads.map((l) => l.id);

  for (const l of myLeads) {
    const at = toMs(l.createdAt);
    if (at === null) continue;
    const how = l.arrival ? describeArrival(parseArrival(l.arrival)) : null;
    const ad = adDetails(l.rawPayload);
    const detail = [
      l.campaign && `Campaign: ${l.campaign}`,
      how && `Arrived from: ${how}`,
      ad && `Ad: ${ad}`,
      l.therapyInterest && `Interested in: ${l.therapyInterest}`,
      // An online purchase's note is written by the system, and the purchase
      // event already says it; a manual lead's note is the team's.
      l.notes && l.source !== "offer" && (l.source === "manual" ? `Note: ${excerpt(l.notes, 160)}` : `They wrote: “${excerpt(l.notes, 160)}”`),
    ]
      .filter(Boolean)
      .join("\n");
    events.push({ at, kind: "first-contact", title: SOURCE_LABEL[l.source] ?? `Came in via ${l.source}`, detail: detail || undefined });
  }

  if (leadIds.length) {
    const stageName = new Map(db.select({ id: pipelineStages.id, name: pipelineStages.name }).from(pipelineStages).all().map((s) => [s.id, s.name]));
    for (const e of db.select().from(leadStageEvents).where(inArray(leadStageEvents.leadId, leadIds)).all()) {
      const at = toMs(e.at);
      if (at === null || e.fromStageId === null) continue; // the entry stage is the first contact itself
      const to = stageName.get(e.toStageId) ?? "another stage";
      const who = e.actor === "automation" ? "automatically" : e.actor === "system" ? "" : "by the team";
      events.push({ at, kind: "stage", title: `Moved to ${to}${who ? ` ${who}` : ""}`, detail: `From ${stageName.get(e.fromStageId) ?? "a previous stage"}` });
    }
    for (const m of db.select().from(leadMessages).where(inArray(leadMessages.leadId, leadIds)).all()) {
      const at = toMs(m.sentAt ?? m.createdAt);
      if (at === null || m.direction === "note") continue;
      events.push({
        at,
        kind: m.direction === "inbound" ? "message-in" : "message-out",
        title: `${m.direction === "inbound" ? "They messaged" : "We messaged"}${m.channel ? ` (${m.channel})` : ""}`,
        detail: excerpt(m.content),
      });
    }
  }

  for (const m of db.select().from(clientMessages).where(eq(clientMessages.clientId, clientId)).all()) {
    const at = toMs(m.sentAt ?? m.createdAt);
    if (at === null) continue;
    events.push({
      at,
      kind: m.direction === "inbound" ? "message-in" : "message-out",
      title: `${m.direction === "inbound" ? "They messaged" : "We messaged"}${m.channel ? ` (${m.channel})` : ""}`,
      detail: excerpt(m.content),
    });
  }

  const clientAt = toMs(client.createdAt);
  if (clientAt !== null) events.push({ at: clientAt, kind: "client", title: "Became a client" });

  for (const o of db
    .select({ o: offerOrders, title: offers.title })
    .from(offerOrders)
    .innerJoin(offers, eq(offers.id, offerOrders.offerId))
    .where(and(eq(offerOrders.clientId, clientId), inArray(offerOrders.status, ["paid", "refunded"])))
    .all()) {
    const at = toMs(o.o.paidAt ?? o.o.createdAt);
    if (at === null) continue;
    events.push({
      at,
      kind: "purchase",
      title: `Bought ${o.title} online, ${eur(o.o.amountCents / 100)}`,
      detail: o.o.status === "refunded" ? "Later refunded" : undefined,
    });
  }

  for (const p of db.select().from(payments).where(eq(payments.clientId, clientId)).all()) {
    if (isOnlinePurchasePayment(p.notes)) continue;
    const at = toMs(p.createdAt);
    if (at === null) continue;
    events.push({ at, kind: "payment", title: `Paid ${eur(p.amountEur)}${p.paymentMethod ? ` by ${p.paymentMethod.replace("_", " ")}` : ""}`, detail: p.notes ?? undefined });
  }

  for (const k of db.select().from(packages).where(eq(packages.clientId, clientId)).all()) {
    if (/^Bought online/.test(k.notes ?? "")) continue; // the purchase event covers it
    const at = toMs(k.purchaseDate);
    if (at === null) continue;
    events.push({ at, kind: "package", title: `Started ${k.packageName}`, detail: `${k.totalSessions} sessions${k.pricePaidEur ? `, ${eur(k.pricePaidEur)}` : ""}` });
  }

  for (const a of db.select().from(appointments).where(eq(appointments.clientId, clientId)).all()) {
    let names = "an appointment";
    try {
      const ids = JSON.parse(a.therapyIds || "[]") as number[];
      const n = ids.map((id) => therapyName.get(id)).filter(Boolean);
      if (n.length) names = n.join(" + ");
    } catch {
      /* keep the generic name */
    }
    const when = `${new Date(`${a.date}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })} at ${a.startTime}`;
    const booked = toMs(a.createdAt);
    if (booked !== null) events.push({ at: booked, kind: "booked", title: `Booked ${names}`, detail: `For ${when}` });
    const slot = toMs(`${a.date}T${a.startTime}:00`);
    if (slot !== null && (a.status === "no_show" || a.status === "cancelled")) {
      events.push({ at: slot, kind: "missed", title: `${a.status === "no_show" ? "Didn't come to" : "Cancelled"} ${names}`, detail: when });
    }
  }

  for (const s of db.select().from(sessions).where(eq(sessions.clientId, clientId)).all()) {
    const at = toMs(s.date);
    if (at === null) continue;
    events.push({
      at,
      kind: "treatment",
      title: `Had ${therapyName.get(s.therapyId) ?? "a treatment"}`,
      detail: [s.durationMinutes ? `${s.durationMinutes} min` : "", s.therapistNotes ? excerpt(s.therapistNotes) : ""].filter(Boolean).join(" · ") || undefined,
    });
  }

  return orderJourney(events);
}
