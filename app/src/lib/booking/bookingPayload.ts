/**
 * Pure: the booking screen's state as the multipart body POST /api/appointments
 * has always taken. The field names and when each is sent are the contract;
 * they match what the old BookingForm sent, field for field, so every server
 * path (existing client / walk-in, package use, new-package sign-up, voucher
 * and split payment) keeps working unchanged.
 */

import type { PackageMode, PaymentMethod } from "./packageChoiceModel";
import type { SecondaryMethod } from "./summaryModel";

export interface NewPackageDraft {
  /** A package template, or null for a custom package. */
  templateId: number | null;
  name: string;
  sessions: number;
  priceEur: number;
  expiry: string;
  /** How the package itself is paid for. */
  paymentMethod: SecondaryMethod;
}

export interface BookingDraft {
  clientMode: "existing" | "walk_in";
  clientId: number | null;
  walkIn: { firstName: string; lastName: string; email: string; phone: string };
  therapyIds: number[];
  date: string;
  startTime: string;
  durationMinutes: number;
  priceEur: number;
  paymentMethod: PaymentMethod;
  packageMode: PackageMode;
  packageId: number | null;
  newPackage: NewPackageDraft;
  voucherCode: string;
  /** Only when the voucher pays less than the session (split payment). */
  secondaryPaymentMethod: SecondaryMethod | null;
  notes: string;
}

export const EMPTY_NEW_PACKAGE: NewPackageDraft = {
  templateId: null,
  name: "",
  sessions: 0,
  priceEur: 0,
  expiry: "",
  paymentMethod: "card",
};

const HM = /^\d{2}:\d{2}$/;

export function bookingEntries(d: BookingDraft): [string, string][] {
  const e: [string, string][] = [];
  for (const id of d.therapyIds) e.push(["therapyIds", String(id)]);
  if (d.clientMode === "existing") {
    if (d.clientId != null) e.push(["clientId", String(d.clientId)]);
  } else {
    e.push(["walkInFirstName", d.walkIn.firstName.trim()]);
    e.push(["walkInLastName", d.walkIn.lastName.trim()]);
    e.push(["walkInEmail", d.walkIn.email.trim()]);
    e.push(["walkInPhone", d.walkIn.phone.trim()]);
  }
  e.push(["date", d.date]);
  e.push(["startTime", d.startTime]);
  e.push(["durationMinutes", String(d.durationMinutes)]);
  const signUp = d.paymentMethod === "package" && d.packageMode === "new";
  // A new package covers the session (EUR 0); the API records the package price as the sale.
  e.push(["totalPriceEur", signUp ? "0" : String(d.priceEur)]);
  e.push(["paymentMethod", d.paymentMethod]);
  if (d.paymentMethod === "package") {
    e.push(["packageMode", d.packageMode]);
    if (d.packageMode === "existing") {
      if (d.packageId != null) e.push(["packageId", String(d.packageId)]);
    } else {
      e.push(["newPackagePaymentMethod", d.newPackage.paymentMethod]);
      if (d.newPackage.templateId != null) {
        e.push(["newPackageTemplateId", String(d.newPackage.templateId)]);
      } else {
        e.push(["newPackageName", d.newPackage.name.trim()]);
        e.push(["newPackageSessions", String(d.newPackage.sessions)]);
        e.push(["newPackagePriceEur", String(d.newPackage.priceEur)]);
        e.push(["newPackageExpiry", d.newPackage.expiry]);
      }
    }
  }
  if (d.paymentMethod === "voucher" && d.voucherCode) {
    e.push(["voucherCode", d.voucherCode]);
    if (d.secondaryPaymentMethod) e.push(["secondaryPaymentMethod", d.secondaryPaymentMethod]);
  }
  e.push(["notes", d.notes]);
  e.push(["status", "scheduled"]);
  return e;
}

export function bookingFormData(d: BookingDraft): FormData {
  const fd = new FormData();
  for (const [k, v] of bookingEntries(d)) fd.append(k, v);
  return fd;
}

/** Client, treatment and a time are set: the Book button can be pressed. */
export function readyToBook(d: BookingDraft): boolean {
  const client = d.clientMode === "existing" ? d.clientId != null : d.walkIn.firstName.trim() !== "";
  return client && d.therapyIds.length > 0 && d.durationMinutes > 0 && HM.test(d.startTime);
}

/** Why this booking cannot be sent yet, in the words the toast shows, or null. */
export function bookingProblem(d: BookingDraft, vocab: { service: string; member: string }): string | null {
  if (d.therapyIds.length === 0 || !(d.durationMinutes > 0)) return `Pick a ${vocab.service.toLowerCase()}.`;
  if (d.clientMode === "existing" && d.clientId == null) return `Pick a ${vocab.member.toLowerCase()}.`;
  if (d.clientMode === "walk_in" && !d.walkIn.firstName.trim()) return `Enter the walk-in ${vocab.member.toLowerCase()}'s first name.`;
  if (!HM.test(d.startTime)) return "Pick a start time.";
  if (
    d.paymentMethod === "package" &&
    d.packageMode === "new" &&
    d.newPackage.templateId == null &&
    (!d.newPackage.name.trim() || d.newPackage.sessions <= 0 || !d.newPackage.expiry)
  ) {
    return "Pick a package template or fill in the custom package details.";
  }
  return null;
}
