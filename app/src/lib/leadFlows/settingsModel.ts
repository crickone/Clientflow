/**
 * A business's lead follow-up settings. Pure: the shape, a lenient read of
 * what is stored, and a strict check for a save. Stored as one JSON value
 * under LEAD_FLOW_SETTINGS_KEY in the tenant's settings table.
 */
import { normalizePhone } from "@/lib/whatsapp/phone";

import { hhmmToMinutes, isHhmm, type SendingWindow } from "./sendingWindow";

export interface LeadFlowSettings {
  /** null = no hours saved: WhatsApp 09:00-21:00 every day, email any time. */
  window: SendingWindow | null;
  /** Who new leads are assigned to, a control-plane user id; null = nobody. */
  defaultAssigneeUserId: number | null;
  /** The number staff alerts go to by WhatsApp, from the business WhatsApp; null = none. */
  alertWhatsAppTo: string | null;
}

export interface LeadFlowSettingsInput {
  window: { days: number[]; start: string; end: string } | null;
  defaultAssigneeUserId: number | null;
  alertWhatsAppTo: string | null;
}

export const LEAD_FLOW_SETTINGS_KEY = "lead_flow_settings";

export const DEFAULT_LEAD_FLOW_SETTINGS: LeadFlowSettings = { window: null, defaultAssigneeUserId: null, alertWhatsAppTo: null };

function cleanDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
}

function readWindow(raw: unknown): SendingWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const days = cleanDays(r.days);
  if (days.length === 0 || !isHhmm(r.start) || !isHhmm(r.end)) return null;
  if (hhmmToMinutes(r.end) <= hhmmToMinutes(r.start)) return null;
  return { days, start: r.start, end: r.end };
}

function readUserId(raw: unknown): number | null {
  return Number.isInteger(raw) && (raw as number) > 0 ? (raw as number) : null;
}

/** What is stored, read leniently: a field that does not make sense falls back to its default. */
export function parseLeadFlowSettings(raw: unknown): LeadFlowSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_LEAD_FLOW_SETTINGS };
  const r = raw as Record<string, unknown>;
  const alert = typeof r.alertWhatsAppTo === "string" ? r.alertWhatsAppTo.trim() : "";
  return {
    window: readWindow(r.window),
    defaultAssigneeUserId: readUserId(r.defaultAssigneeUserId),
    alertWhatsAppTo: alert || null,
  };
}

/** A save, checked strictly. The error says what to change. */
export function validateLeadFlowSettings(
  input: LeadFlowSettingsInput,
): { ok: true; value: LeadFlowSettings } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Nothing to save." };
  let window: SendingWindow | null = null;
  if (input.window) {
    const days = cleanDays(input.window.days);
    if (days.length === 0) return { ok: false, error: "Pick at least one day." };
    if (!isHhmm(input.window.start) || !isHhmm(input.window.end)) return { ok: false, error: "Use a time like 09:00." };
    if (hhmmToMinutes(input.window.end) <= hhmmToMinutes(input.window.start)) {
      return { ok: false, error: "The end time must be after the start time." };
    }
    window = { days, start: input.window.start, end: input.window.end };
  }
  if (input.defaultAssigneeUserId !== null && readUserId(input.defaultAssigneeUserId) === null) {
    return { ok: false, error: "Pick someone from the list, or nobody." };
  }
  const alert = (input.alertWhatsAppTo ?? "").trim();
  if (alert) {
    const digits = normalizePhone(alert);
    if (digits.length < 8 || digits.length > 15) {
      return { ok: false, error: "Enter the WhatsApp number with its area code, for example 087 000 0000." };
    }
  }
  return { ok: true, value: { window, defaultAssigneeUserId: input.defaultAssigneeUserId, alertWhatsAppTo: alert || null } };
}
