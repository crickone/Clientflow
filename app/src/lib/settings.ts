import "server-only";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { settings } from "./db/schema";
import type { VenueType } from "./vocabulary";
import {
  DEFAULT_BODY_FONT_ID,
  DEFAULT_HEADING_FONT_ID,
} from "@/lib/image/fonts";
import { DEFAULT_THEME, HEADING_FONTS, isHexColor, type ThemeConfig } from "@/lib/theme";

export type { VenueType };

export interface OpeningHour {
  dow: number; // 0=Sun..6=Sat
  closed: boolean;
  open?: string; // "HH:mm"
  close?: string;
}

export interface ClinicSettings {
  openingHours: OpeningHour[];
  slotLengthMinutes: number;
  multiTherapyConcurrent: boolean;
  bufferMinutes: number;
}

const DEFAULTS: ClinicSettings = {
  openingHours: [
    { dow: 0, closed: true },
    { dow: 1, closed: false, open: "08:00", close: "20:00" },
    { dow: 2, closed: false, open: "08:00", close: "20:00" },
    { dow: 3, closed: false, open: "08:00", close: "20:00" },
    { dow: 4, closed: false, open: "08:00", close: "20:00" },
    { dow: 5, closed: false, open: "08:00", close: "20:00" },
    { dow: 6, closed: false, open: "09:00", close: "16:00" },
  ],
  slotLengthMinutes: 30,
  multiTherapyConcurrent: true,
  bufferMinutes: 0,
};

export function readKey<T>(key: string, fallback: T): T {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function getSettings(): ClinicSettings {
  return {
    openingHours: readKey("opening_hours", DEFAULTS.openingHours),
    slotLengthMinutes: Number(
      readKey("slot_length_minutes", DEFAULTS.slotLengthMinutes),
    ),
    multiTherapyConcurrent: Boolean(
      readKey("multi_therapy_concurrent", DEFAULTS.multiTherapyConcurrent),
    ),
    bufferMinutes: Number(readKey("buffer_minutes", DEFAULTS.bufferMinutes)),
  };
}

export function setKey(key: string, value: unknown) {
  const json = JSON.stringify(value);
  db.insert(settings)
    .values({ key, value: json })
    .onConflictDoUpdate({ target: settings.key, set: { value: json } })
    .run();
}

export function deleteKey(key: string) {
  db.delete(settings).where(eq(settings.key, key)).run();
}

/**
 * Branding logo filename, stored relative to data/branding/. Used by the
 * Content Studio intro/outro cards. Null when no logo has been uploaded.
 */
export function getBrandingLogoFilename(): string | null {
  const v = readKey<string | null>("branding_logo_filename", null);
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Venue type drives the user-facing vocabulary (Clients/Therapies vs
 * Members/Classes). The internal data model is identical for both.
 */
export function getVenueType(): VenueType {
  const v = readKey<string>("venue_type", "clinic");
  return v === "gym" ? "gym" : "clinic";
}

export function setVenueType(v: VenueType) {
  setKey("venue_type", v);
}

/**
 * Account-level default fonts for Content Studio. New designs and any slide
 * without an explicit override render with these. Stored as font option ids
 * (see src/lib/image/fonts.ts); fall back to the global defaults when unset.
 */
export function getBrandFontIds(): { heading: string; body: string } {
  return {
    heading: readKey<string>("brand_heading_font", DEFAULT_HEADING_FONT_ID),
    body: readKey<string>("brand_body_font", DEFAULT_BODY_FONT_ID),
  };
}

export function setBrandFontIds(input: { heading: string; body: string }) {
  setKey("brand_heading_font", input.heading);
  setKey("brand_body_font", input.body);
}

/**
 * Per-tenant app theme (page background + accent). The rest of the token
 * palette is derived from these two colours (see @/lib/theme). Unset → the
 * default dark-premium theme.
 */
export function getTheme(): ThemeConfig {
  const raw = readKey<Partial<ThemeConfig> | null>("theme", null);
  const validFont = new Set(HEADING_FONTS.map((f) => f.id));
  return {
    bg: raw && isHexColor(raw.bg) ? raw.bg : DEFAULT_THEME.bg,
    accent: raw && isHexColor(raw.accent) ? raw.accent : DEFAULT_THEME.accent,
    headingFont:
      raw && typeof raw.headingFont === "string" && validFont.has(raw.headingFont)
        ? raw.headingFont
        : DEFAULT_THEME.headingFont,
  };
}

export function setTheme(cfg: ThemeConfig) {
  setKey("theme", cfg);
}

export function clearTheme() {
  deleteKey("theme");
}
