import "server-only";

import { db } from "@/lib/db";
import { packages } from "@/lib/db/schema";

export interface CreatePackageInput {
  clientId: number;
  therapyId: number;
  packageName: string;
  totalSessions: number;
  pricePaidEur: number;
  expiryDate: string; // YYYY-MM-DD
  notes?: string | null;
}

/**
 * Insert a prepaid-sessions package and return its id. Shared by the standalone
 * "sell package" flow and the "sign up at booking" flow so package creation has
 * one source of truth. Does NOT record a payment — the caller does that (their
 * payment shape differs: voucher splits on the sell page, a single sale row at
 * booking).
 */
export function createPackage(input: CreatePackageInput): number {
  const row = db
    .insert(packages)
    .values({
      clientId: input.clientId,
      therapyId: input.therapyId,
      packageName: input.packageName,
      totalSessions: input.totalSessions,
      sessionsUsed: 0,
      pricePaidEur: input.pricePaidEur,
      purchaseDate: new Date().toISOString().slice(0, 10),
      expiryDate: input.expiryDate,
      isActive: true,
      notes: input.notes ?? null,
    })
    .returning({ id: packages.id })
    .all();
  return row[0].id;
}

/** Expiry date = today + N months, as YYYY-MM-DD (for template validityMonths). */
export function expiryFromMonths(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}
