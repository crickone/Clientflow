/**
 * Which modules a business has.
 *
 * The app has around twenty-five destinations; they collapse to the dozen
 * below, because a client either does nutrition or does not, and the three
 * nutrition pages travel together. A base price plus add-ons was the pricing
 * already agreed, so the switch is per module rather than per tier; tiers
 * can arrive later as presets that set the same flags.
 *
 * UNSET MEANS EVERYTHING ON. A tenant with no `features` key behaves exactly
 * as it did before this existed, which is what makes the change safe to ship
 * to a live fleet. Only an explicit `false` turns something off.
 *
 * NO SERVER IMPORTS. The sidebar (a client component) and the route guard (a
 * server module) both read this, so it stays pure.
 */

export interface ModuleDef {
  key: string;
  label: string;
  /** What the client loses if it is switched off, in their terms. */
  blurb: string;
  /** Path prefixes this module owns. The guard matches on these. */
  paths: string[];
}

export const MODULE_CATALOG: ModuleDef[] = [
  { key: "leads", label: "Leads", blurb: "The pipeline board and lead intake.", paths: ["/leads"] },
  { key: "communication", label: "Communication", blurb: "The combined inbox: email and WhatsApp.", paths: ["/communication"] },
  { key: "calendar", label: "Calendar and appointments", blurb: "One-to-one bookings and the calendar.", paths: ["/calendar", "/appointments"] },
  { key: "timetable", label: "Timetable and attendance", blurb: "Group classes, the schedule and attendance.", paths: ["/timetable", "/attendance"] },
  { key: "nutrition", label: "Nutrition", blurb: "Nutrition plans, meals and the food library.", paths: ["/nutrition"] },
  { key: "workout", label: "Workout", blurb: "Programs, workouts, circuits and the exercise library.", paths: ["/workout"] },
  { key: "forms", label: "Forms", blurb: "Questionnaires, check-ins, habits and contact forms.", paths: ["/forms"] },
  { key: "automations", label: "Automations", blurb: "Trigger-based message series.", paths: ["/automations"] },
  { key: "products", label: "Memberships and packages", blurb: "Memberships, packages, session bundles and vouchers.", paths: ["/memberships", "/session-packages", "/packages", "/vouchers"] },
  { key: "staff", label: "Staff and reports", blurb: "The staff roster, payroll and reporting.", paths: ["/staff", "/reports"] },
  { key: "marketing", label: "Marketing and websites", blurb: "Campaigns, the seasonal calendar, research, the CMS and the schedule.", paths: ["/marketing", "/cms"] },
  { key: "content_studio", label: "Content Studio", blurb: "Designed posts, blogs and video.", paths: ["/content-studio"] },
  { key: "email_campaigns", label: "Email campaigns", blurb: "Bulk email, contacts and sending domains.", paths: ["/campaigns"] },
  { key: "client_app", label: "Client app", blurb: "The members' own app and its branding.", paths: ["/my-app"] },
];

export const MODULE_KEYS: readonly string[] = MODULE_CATALOG.map((m) => m.key);

/** A tenant's flags. Absent keys, and an absent object, mean on. */
export type FeatureFlags = Record<string, boolean>;

export function parseFeatureFlags(raw: unknown): FeatureFlags {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: FeatureFlags = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (MODULE_KEYS.includes(k) && typeof v === "boolean") out[k] = v;
  }
  return out;
}

export function isModuleOn(flags: FeatureFlags, key: string): boolean {
  return flags[key] !== false;
}

/**
 * The module that owns a path, or null when no module claims it (the
 * dashboard, settings, Adonis: never switchable, because a business with no
 * settings page cannot be supported).
 *
 * Longest prefix wins, so `/nutrition/foods` resolves to nutrition rather
 * than to anything that happens to share a shorter prefix.
 */
export function moduleForPath(pathname: string): ModuleDef | null {
  let best: { def: ModuleDef; length: number } | null = null;
  for (const def of MODULE_CATALOG) {
    for (const p of def.paths) {
      if ((pathname === p || pathname.startsWith(`${p}/`)) && (!best || p.length > best.length)) {
        best = { def, length: p.length };
      }
    }
  }
  return best?.def ?? null;
}

/** Whether a path may be opened with these flags. Unclaimed paths are always allowed. */
export function pathAllowed(flags: FeatureFlags, pathname: string): boolean {
  const def = moduleForPath(pathname);
  return def ? isModuleOn(flags, def.key) : true;
}
