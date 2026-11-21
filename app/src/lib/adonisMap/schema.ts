// app/src/lib/adonisMap/schema.ts
/**
 * The Adonis business map: the object types Adonis can read, their fields and
 * their links. Pure description; the SQL that fills each type is in load.ts.
 */
import { isModuleOn } from "@/lib/features";
import type { FieldDef, TypeDef, TypeName } from "./types";

export const STAGES = ["lead", "member", "lapsed", "client"] as const;
export const BOOKING_STATUSES = ["booked", "attended", "no_show", "cancelled"] as const;
export const CHANNELS = ["email", "sms", "whatsapp", "messenger", "instagram", "call", "manual", "system"] as const;

const EVENT_ROWS = 5000;
const PEOPLE_ROWS = 25000;

const ownedBy: FieldDef[] = [
  { name: "personId", type: "text", about: "The Person this belongs to" },
  { name: "personName", type: "text", about: "That Person's name" },
];

const toPerson = { name: "person", target: "Person" as const, from: "personId", to: "id", about: "Who it belongs to" };

export const TYPE_DEFS: Record<TypeName, TypeDef> = {
  Person: {
    name: "Person",
    about: "One human: a client, or a lead who isn't a client yet. A lead and a client who are the same human are one Person.",
    idHint: "c:12 is client 12; l:40 is lead 40 with no client record",
    dateField: null,
    maxRows: PEOPLE_ROWS,
    fields: [
      { name: "name", type: "text", about: "Full name" },
      { name: "firstName", type: "text", about: "First name" },
      { name: "email", type: "text", about: "Email" },
      { name: "phone", type: "text", about: "Phone" },
      { name: "kind", type: "enum", values: ["client", "lead"], about: "client, or lead only" },
      { name: "stage", type: "enum", values: STAGES, computed: true, about: "See the stage rule" },
      { name: "pipelineStage", type: "text", about: "Stage on the leads board, from their latest lead record" },
      { name: "source", type: "text", about: "Where their latest lead came from, e.g. facebook, website" },
      { name: "campaign", type: "text", about: "Campaign named on their latest lead" },
      { name: "leadScore", type: "number", about: "Readiness to buy, 0-100, from their latest scored lead" },
      { name: "doNotCall", type: "bool", about: "Asked not to be phoned" },
      { name: "createdAt", type: "date", about: "First time they appear (earliest record)" },
      { name: "joinedAt", type: "date", about: "When the client record was made; null for leads" },
      { name: "lastVisit", type: "date", computed: true, about: "Last attended class or completed appointment" },
      { name: "visits30d", type: "number", computed: true, about: "Visits in the last 30 days" },
      { name: "futureBookings", type: "number", computed: true, about: "Booked classes or appointments from today on" },
      { name: "lifetimeSpendEur", type: "number", computed: true, about: "Paid online orders, completed appointment prices and package prices" },
      { name: "lastContactedAt", type: "datetime", computed: true, about: "Last message we sent them" },
      { name: "lastMessageAt", type: "datetime", computed: true, about: "Last message either way" },
      { name: "possibleMatches", type: "number", computed: true, about: "Other records that may be the same person, waiting for staff" },
    ],
    links: [
      { name: "bookings", target: "Booking", from: "id", to: "personId", about: "Their class bookings and appointments" },
      { name: "memberships", target: "Membership", from: "id", to: "personId", about: "Their memberships" },
      { name: "packages", target: "Package", from: "id", to: "personId", about: "Their packages" },
      { name: "orders", target: "Order", from: "id", to: "personId", about: "What they bought online" },
      { name: "conversations", target: "Conversation", from: "id", to: "personId", about: "Their message threads, one per channel" },
    ],
  },
  Booking: {
    name: "Booking",
    about: "A place in a class, or an appointment.",
    idHint: "s:5 is class booking 5; a:9 is appointment 9",
    dateField: "date",
    maxRows: EVENT_ROWS,
    fields: [
      { name: "kind", type: "enum", values: ["class", "appointment"], about: "Class booking or appointment" },
      { name: "date", type: "date", about: "The day of the class or appointment" },
      { name: "startsAt", type: "datetime", about: "Start, Irish time" },
      { name: "status", type: "enum", values: BOOKING_STATUSES, about: "booked (ahead or not yet marked), attended, no_show, cancelled" },
      { name: "name", type: "text", about: "Class name, or the therapies booked" },
      { name: "instructor", type: "text", about: "Class instructor; null for appointments" },
      { name: "priceEur", type: "number", about: "Appointment price; null for classes" },
      ...ownedBy,
      { name: "classId", type: "text", about: "The Class; null for appointments" },
    ],
    links: [toPerson, { name: "class", target: "Class", from: "classId", to: "id", about: "The class session" }],
  },
  Class: {
    name: "Class",
    about: "One scheduled session of a group class.",
    idHint: "k:3 is class session 3",
    dateField: "date",
    maxRows: EVENT_ROWS,
    fields: [
      { name: "name", type: "text", about: "Class name" },
      { name: "date", type: "date", about: "Day" },
      { name: "startsAt", type: "datetime", about: "Start, Irish time" },
      { name: "endTime", type: "text", about: "End, HH:mm" },
      { name: "category", type: "text", about: "Category" },
      { name: "capacity", type: "number", about: "Places" },
      { name: "instructor", type: "text", about: "Instructor's name" },
      { name: "status", type: "enum", values: ["scheduled", "cancelled"], about: "Whether it ran" },
      { name: "booked", type: "number", computed: true, about: "Booked, attended or no-show" },
      { name: "placesLeft", type: "number", computed: true, about: "Capacity minus booked and attended" },
      { name: "fillRate", type: "number", computed: true, about: "Booked as a percentage of capacity" },
    ],
    links: [{ name: "bookings", target: "Booking", from: "id", to: "classId", about: "Who booked it" }],
  },
  Membership: {
    name: "Membership",
    about: "A plan a client is on.",
    idHint: "m:4",
    dateField: null,
    maxRows: PEOPLE_ROWS,
    fields: [
      { name: "plan", type: "text", about: "Plan name" },
      { name: "priceEur", type: "number", about: "Price" },
      { name: "status", type: "enum", values: ["active", "expired", "cancelled"], about: "Status" },
      { name: "startDate", type: "date", about: "Start" },
      { name: "nextBillingDate", type: "date", about: "Next renewal" },
      { name: "endedAt", type: "date", about: "When it stopped being active" },
      { name: "monthsOnPlan", type: "number", computed: true, about: "Whole months from start to end or today" },
      ...ownedBy,
    ],
    links: [toPerson],
  },
  Package: {
    name: "Package",
    about: "A prepaid bundle of sessions.",
    idHint: "p:7 is a package; b:2 is a clinic session bundle",
    dateField: null,
    maxRows: PEOPLE_ROWS,
    fields: [
      { name: "name", type: "text", about: "Package name" },
      { name: "kind", type: "enum", values: ["package", "bundle"], about: "Class package or clinic session bundle" },
      { name: "sessionsTotal", type: "number", about: "Sessions bought" },
      { name: "sessionsUsed", type: "number", about: "Sessions used" },
      { name: "sessionsLeft", type: "number", computed: true, about: "Sessions left; null when unlimited" },
      { name: "unlimited", type: "bool", about: "Unlimited sessions" },
      { name: "started", type: "bool", about: "Activated (a package that starts on first booking is not started until then)" },
      { name: "status", type: "enum", values: ["active", "expired", "cancelled"], about: "Status" },
      { name: "startDate", type: "date", about: "Bought or started" },
      { name: "endDate", type: "date", about: "Expiry" },
      { name: "priceEur", type: "number", about: "Price paid" },
      ...ownedBy,
    ],
    links: [toPerson],
  },
  Order: {
    name: "Order",
    about: "Something bought online through Stripe.",
    idHint: "o:3",
    dateField: null,
    // No date field to narrow a load by, so the people-sized cap: a busy business never loses Person lookups to it.
    maxRows: PEOPLE_ROWS,
    fields: [
      { name: "offer", type: "text", about: "Offer name" },
      { name: "amountEur", type: "number", about: "Amount" },
      { name: "status", type: "enum", values: ["pending", "paid", "expired", "refunded", "failed"], about: "pending or expired = checkout started, not paid" },
      { name: "createdAt", type: "datetime", about: "Checkout started" },
      { name: "paidAt", type: "datetime", about: "Paid" },
      { name: "personId", type: "text", about: "The buyer's Person; null when they match no one" },
      { name: "personName", type: "text", about: "Buyer's name" },
      { name: "email", type: "text", about: "Buyer's email" },
    ],
    links: [toPerson],
  },
  Conversation: {
    name: "Conversation",
    about: "One person's messages on one channel. Message text is only shown by map_get.",
    idHint: "c:12|whatsapp",
    dateField: null,
    maxRows: PEOPLE_ROWS,
    fields: [
      { name: "channel", type: "enum", values: CHANNELS, about: "Channel" },
      { name: "messageCount", type: "number", about: "Messages" },
      { name: "lastMessageAt", type: "datetime", about: "Last message either way" },
      { name: "lastDirection", type: "enum", values: ["in", "out"], about: "in = they wrote last" },
      { name: "lastOutboundAt", type: "datetime", about: "Last message we sent" },
      { name: "waitingForReply", type: "bool", computed: true, about: "Their message was the last one" },
      { name: "hoursWaiting", type: "number", computed: true, about: "Hours since their unanswered message" },
      ...ownedBy,
    ],
    links: [toPerson],
  },
};

export interface MapModules { timetable: boolean; calendar: boolean; products: boolean; communication: boolean }
export const ALL_MODULES: MapModules = { timetable: true, calendar: true, products: true, communication: true };

export function modulesFrom(flags: Record<string, boolean>): MapModules {
  return {
    timetable: isModuleOn(flags, "timetable"),
    calendar: isModuleOn(flags, "calendar"),
    products: isModuleOn(flags, "products"),
    communication: isModuleOn(flags, "communication"),
  };
}

/** The types a business has, in a fixed order. Person and Order always exist. */
export function availableTypes(m: MapModules): TypeName[] {
  const out: TypeName[] = ["Person"];
  if (m.timetable || m.calendar) out.push("Booking");
  if (m.timetable) out.push("Class");
  if (m.products) out.push("Membership", "Package");
  out.push("Order");
  if (m.communication) out.push("Conversation");
  return out;
}
