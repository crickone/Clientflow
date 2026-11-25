/**
 * Pure: the words and money on the Booking summary (the right-hand panel and
 * the narrow-screen bar). Mirrors what the POST will record: a session paid
 * from a package is worth what the package cost per session
 * (perSessionValue), not the treatment's list price.
 */

import { perSessionValue } from "@/lib/packageBalanceModel";

import { addMinutes, euro, shortDate } from "./format";
import type { PackageMode, PaymentMethod } from "./packageChoiceModel";
import type { VoucherCoverage } from "./voucherModel";

export type SecondaryMethod = "cash" | "card" | "bank_transfer";

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank transfer",
  voucher: "Gift voucher",
  package: "Prepaid package",
};

export function methodLabel(m: PaymentMethod): string {
  return METHOD_LABEL[m];
}

export interface SummaryInput {
  /** The selected treatment's list price; 0 when none is picked. */
  listPrice: number;
  /** The price the booking will send (list price, or what staff typed). */
  price: number;
  paymentMethod: PaymentMethod;
  packageMode: PackageMode;
  /** The package paying, when paying from an existing one. */
  pkg: { packageName: string; pricePaidEur: number; totalSessions: number } | null;
  /** The package being sold with this booking (package + new). */
  newPackage: { name: string; priceEur: number } | null;
  /** Null unless paying by voucher with a code typed. */
  voucher: (VoucherCoverage & { valid: boolean }) | null;
  secondaryMethod: SecondaryMethod;
  /** The venue's word for a package, lower case. Defaults to "package". */
  planWord?: string;
}

export interface SummaryMoney {
  /** The big number. */
  value: number;
  /** The list price struck through beside it, or null. */
  struck: number | null;
  /** The Payment row. */
  paymentLabel: string;
  /** "Prepaid", "Card": the narrow-screen bar. */
  shortPayment: string;
  /** The line under the value. */
  note: string;
  /** "paid" draws the note in the success colour. */
  tone: "paid" | "due";
}

const DUE = "To pay on the day.";

export function summaryMoney(i: SummaryInput): SummaryMoney {
  if (i.paymentMethod === "package" && i.packageMode === "existing" && i.pkg) {
    const value = perSessionValue(i.pkg);
    return {
      value,
      struck: i.listPrice > 0 && i.listPrice !== value ? i.listPrice : null,
      paymentLabel: i.pkg.packageName,
      shortPayment: "Prepaid",
      note: `Already paid. Uses 1 prepaid session from ${i.pkg.packageName}.`,
      tone: "paid",
    };
  }
  if (i.paymentMethod === "package" && i.packageMode === "new") {
    const name = i.newPackage?.name.trim() || "New package";
    return {
      value: i.newPackage?.priceEur ?? 0,
      struck: null,
      paymentLabel: `New: ${name}`,
      shortPayment: "New package",
      note: "Sold with this booking. This session uses one of its sessions.",
      tone: "due",
    };
  }
  if (i.paymentMethod === "voucher" && i.voucher?.valid && !i.voucher.wrongTreatment && !i.voucher.noPrice) {
    if (i.voucher.needsSplit) {
      const rest = Math.round((i.price - i.voucher.covers) * 100) / 100;
      const second = methodLabel(i.secondaryMethod);
      return {
        value: i.price,
        struck: null,
        paymentLabel: `Gift voucher and ${second.toLowerCase()}`,
        shortPayment: "Voucher",
        note: `Voucher pays ${euro(i.voucher.covers)}. ${euro(rest)} to pay by ${second.toLowerCase()}.`,
        tone: "due",
      };
    }
    return { value: i.price, struck: null, paymentLabel: "Gift voucher", shortPayment: "Voucher", note: "Paid by gift voucher.", tone: "paid" };
  }
  const label = i.paymentMethod === "package" ? `Prepaid ${i.planWord ?? "package"}` : methodLabel(i.paymentMethod);
  return { value: i.price, struck: null, paymentLabel: label, shortPayment: label, note: DUE, tone: "due" };
}

/** "Thu 26 Nov, 12:45 to 13:45"; just the day until a time is picked. */
export function whenLabel(date: string, startTime: string, durationMinutes: number): string {
  if (!date) return "";
  if (!/^\d{2}:\d{2}$/.test(startTime)) return shortDate(date);
  if (!(durationMinutes > 0)) return `${shortDate(date)}, ${startTime}`;
  return `${shortDate(date)}, ${startTime} to ${addMinutes(startTime, durationMinutes)}`;
}

/** "Book Mary in", or the venue's own phrase until there is a name. */
export function bookLabel(firstName: string, fallback: string): string {
  const name = firstName.trim();
  return name ? `Book ${name} in` : fallback;
}
