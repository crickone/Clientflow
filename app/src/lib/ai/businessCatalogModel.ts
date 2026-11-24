/**
 * Pure: turns the business's offers, packages, memberships and gift vouchers
 * into the plain lines an AI reply reads as fact. See businessCatalog.ts for
 * where the data comes from.
 */

export interface CatalogOffer {
  title: string;
  price: string;
  usual: string | null;
  includes: string[];
  description: string;
  useBy: string;
  startsOn: string | null;
  endsOn: string | null;
  left: number | null;
  url: string | null;
}

export interface CatalogData {
  offers: CatalogOffer[];
  bundles: { name: string; sessions: number; therapy: string | null; price: string | null; validityMonths: number | null; recurring: string | null; notes: string }[];
  packages: { name: string; price: string; sessions: string; validFor: string | null; description: string }[];
  memberships: { name: string; price: string; every: string; joiningFee: string | null; sessions: string | null; description: string }[];
  vouchers: { amounts: string[]; custom: string | null; treatments: string[]; validYears: number; url: string | null } | null;
}

const clip = (s: string, n = 220) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

export function catalogText(d: CatalogData): string {
  const parts: string[] = [];

  if (d.offers.length) {
    parts.push("Offers:");
    for (const o of d.offers) {
      const bits = [`${o.price}${o.usual ? ` (usually ${o.usual})` : ""}`];
      if (o.includes.length) bits.push(`includes ${o.includes.join(", ")}`);
      bits.push(o.useBy.charAt(0).toLowerCase() + o.useBy.slice(1));
      if (o.startsOn) bits.push(`on sale from ${o.startsOn}`);
      else bits.push(o.endsOn ? `on sale until ${o.endsOn}` : "on sale now");
      if (o.left !== null) bits.push(o.left === 0 ? "sold out" : `${o.left} left`);
      if (o.url) bits.push(`buy online at ${o.url}`);
      const desc = o.description ? ` ${clip(o.description)}` : "";
      parts.push(`- ${o.title}: ${bits.join("; ")}.${desc}`);
    }
  }

  if (d.bundles.length) {
    parts.push("", "Session bundles:");
    for (const b of d.bundles) {
      const what = `${b.sessions} x ${b.therapy ?? "sessions"}`;
      const bits = [b.price ? `${what} for ${b.price}` : what];
      if (b.recurring) bits.push(b.recurring);
      if (b.validityMonths) bits.push(`valid ${b.validityMonths} month${b.validityMonths === 1 ? "" : "s"}`);
      parts.push(`- ${b.name}: ${bits.join("; ")}.${b.notes ? ` ${clip(b.notes)}` : ""}`);
    }
  }

  if (d.packages.length) {
    parts.push("", "Packages:");
    for (const p of d.packages) {
      const bits = [`${p.price} for ${p.sessions}`];
      if (p.validFor) bits.push(`valid ${p.validFor}`);
      parts.push(`- ${p.name}: ${bits.join("; ")}.${p.description ? ` ${clip(p.description)}` : ""}`);
    }
  }

  if (d.memberships.length) {
    parts.push("", "Memberships:");
    for (const m of d.memberships) {
      const bits = [`${m.price} every ${m.every}`];
      if (m.joiningFee) bits.push(`${m.joiningFee} joining fee`);
      if (m.sessions) bits.push(m.sessions);
      parts.push(`- ${m.name}: ${bits.join("; ")}.${m.description ? ` ${clip(m.description)}` : ""}`);
    }
  }

  if (d.vouchers) {
    const v = d.vouchers;
    const kinds = [
      v.amounts.length ? `amounts of ${v.amounts.join(", ")}` : null,
      v.custom,
      v.treatments.length ? `a voucher for one session of ${v.treatments.join(", ")}` : null,
    ].filter(Boolean);
    parts.push(
      "",
      "Gift vouchers:",
      `- Sold online${v.url ? ` at ${v.url}` : ""}: ${kinds.join("; ") || "money vouchers"}. Valid ${v.validYears} years. A money voucher keeps any unused balance.`,
    );
  }

  if (parts.length === 0) return "";
  return [
    ...parts,
    "",
    "Quote these prices exactly as written. Mention an offer only while it is on sale, and never invent a discount, bundle or price that is not listed here or in the services.",
  ].join("\n");
}
