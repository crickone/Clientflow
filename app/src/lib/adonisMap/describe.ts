import { TYPE_DEFS } from "./schema";
import type { TypeName } from "./types";

export const STAGE_RULE =
  "Stage rule: lead = only lead records. member = an active membership, an active package with sessions left, or a visit in the last 30 days. lapsed = a past visit, none in the last 30 days, and nothing booked ahead. client = any other client. A visit is an attended class or a completed appointment.";

export const MAP_ROUTING =
  "For questions about people, bookings, classes, memberships, packages, online orders or messages, use the map tools (map_find, map_get, map_follow, map_count). For ads, posts, the website, campaigns and anything that changes something, use your other tools.";

/** The compact map summary for Adonis's prompt. Only the types (and links between them) this business has. */
export function describeMap(types: TypeName[]): string {
  const have = new Set(types);
  const lines: string[] = [
    "You can read this business as one connected map. Each type lists its fields (name:type, * = worked out) and its links.",
  ];
  for (const t of types) {
    const d = TYPE_DEFS[t];
    lines.push("", `${d.name}: ${d.about} Ids: ${d.idHint}.`);
    lines.push(
      "  fields: " +
        d.fields
          .map((f) => `${f.name}:${f.type === "enum" ? `enum(${(f.values ?? []).join("|")})` : f.type}${f.computed ? "*" : ""}`)
          .join(", "),
    );
    const links = d.links.filter((l) => have.has(l.target));
    if (links.length) lines.push("  links: " + links.map((l) => `${l.name} -> ${l.target}`).join(", "));
  }
  lines.push(
    "",
    STAGE_RULE,
    "Dates are Irish dates, YYYY-MM-DD. Datetimes are 'YYYY-MM-DD HH:mm', Irish time; a date value filters a datetime by its day.",
    "Conditions: { field, op, value } with op eq, ne, gt, gte, lt, lte, in, contains, between, isNull; or { link, exists, where } for has / has no linked records.",
    "Results are capped (50 rows, 100 groups). Use map_count for totals instead of counting rows yourself.",
    MAP_ROUTING,
  );
  return lines.join("\n");
}
