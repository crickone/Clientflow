/**
 * Pure: which prepaid package (if any) pays for the booking being made.
 *
 * The client's usable packages come from GET /api/packages?clientId&date:
 * active, not expired by the booking's date, and with a session left once the
 * sessions already booked on them are held (`available`). The server checks
 * all of that again on POST; this module only decides what the screen offers
 * and pre-selects, so a prepaid session (a Black Friday buyer's) is used by
 * default instead of charging for the treatment again.
 */

import { fullDate } from "./format";

export type PaymentMethod = "cash" | "card" | "package" | "voucher" | "bank_transfer";
export type PackageMode = "existing" | "new";

/** One row of GET /api/packages. */
export interface UsablePackage {
  id: number;
  therapyId: number;
  packageName: string;
  totalSessions: number;
  sessionsUsed: number;
  pricePaidEur: number;
  expiryDate: string;
  /** Sessions left once booked-but-not-done sessions are held. */
  available: number;
}

export interface PaymentChoice {
  paymentMethod: PaymentMethod;
  packageMode: PackageMode;
  packageId: number | null;
}

/** The packages that can pay for this treatment. */
export function packagesFor(packages: UsablePackage[], therapyId: number | null): UsablePackage[] {
  if (therapyId == null) return [];
  return packages.filter((p) => p.therapyId === therapyId && p.available > 0);
}

/**
 * Re-run whenever the client's packages, the treatment or the date change.
 *
 * - Signing up for a NEW package is left alone.
 * - The picked package is kept while it still fits; otherwise the first that fits.
 * - Until staff pick a payment method themselves (`methodChosen`), a fitting
 *   package becomes the payment.
 * - Paying by package with nothing that fits falls back to `fallback`.
 */
export function reconcilePackageChoice(
  choice: PaymentChoice,
  packages: UsablePackage[],
  therapyId: number | null,
  methodChosen: boolean,
  fallback: PaymentMethod = "cash",
): PaymentChoice {
  if (choice.paymentMethod === "package" && choice.packageMode === "new") return choice;
  const fits = packagesFor(packages, therapyId);
  const kept = choice.packageId != null && fits.some((p) => p.id === choice.packageId);
  const packageId = kept ? choice.packageId : (fits[0]?.id ?? null);
  if (packageId != null && !methodChosen) return { paymentMethod: "package", packageMode: "existing", packageId };
  if (choice.paymentMethod === "package" && packageId == null) {
    return { paymentMethod: fallback, packageMode: "existing", packageId: null };
  }
  return { ...choice, packageId };
}

export function sameChoice(a: PaymentChoice, b: PaymentChoice): boolean {
  return a.paymentMethod === b.paymentMethod && a.packageMode === b.packageMode && a.packageId === b.packageId;
}

/** One green banner line on the Client card. */
export interface PrepaidOffer {
  packageId: number;
  therapyId: number;
  /** Sessions left to book. */
  count: number;
  treatment: string;
  minutes: number;
  packageName: string;
  expiryDate: string;
}

/** One offer per usable package whose treatment is on the list (a retired treatment cannot be booked). */
export function prepaidOffers(
  packages: UsablePackage[],
  treatments: { id: number; name: string; defaultDurationMinutes: number }[],
): PrepaidOffer[] {
  const byId = new Map(treatments.map((t) => [t.id, t]));
  const out: PrepaidOffer[] = [];
  for (const p of packages) {
    const t = byId.get(p.therapyId);
    if (!t || p.available <= 0) continue;
    out.push({
      packageId: p.id,
      therapyId: p.therapyId,
      count: p.available,
      treatment: t.name,
      minutes: t.defaultDurationMinutes,
      packageName: p.packageName,
      expiryDate: p.expiryDate,
    });
  }
  return out;
}

/**
 * The banner sentence in three parts, so the middle can be bold:
 * "Mary has " + "1 prepaid Deep tissue massage" + ", 60 min, from Black Friday. Use by 1 Mar 2027."
 */
export function offerText(offer: PrepaidOffer, firstName: string): { lead: string; strong: string; rest: string } {
  const who = firstName.trim() || "This client";
  return {
    lead: `${who} has `,
    strong: `${offer.count} prepaid ${offer.treatment}`,
    rest: `, ${offer.minutes} min, from ${offer.packageName}. Use by ${fullDate(offer.expiryDate)}.`,
  };
}
