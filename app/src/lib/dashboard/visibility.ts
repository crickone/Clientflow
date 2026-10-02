/**
 * Who may see which dashboard widget. Admins see everything. Staff see a
 * widget when the admin's override says so, else by sensitivity: general
 * widgets visible, financial and spend widgets hidden.
 *
 * `visibleRefs` is the server-side gate the page runs BEFORE any widget
 * loads, so hidden data never leaves the server. Pure.
 */
import { CATALOG_BY_KEY } from "./catalog";
import type { Venue, WidgetMeta, WidgetRef } from "./types";

export type VisibilityOverrides = Record<string, boolean>;

export function staffCanSeeByDefault(meta: WidgetMeta): boolean {
  return meta.sensitivity === "general";
}

export function canSee(meta: WidgetMeta, role: "admin" | "staff", overrides: VisibilityOverrides): boolean {
  if (role === "admin") return true;
  const o = overrides[meta.key];
  return typeof o === "boolean" ? o : staffCanSeeByDefault(meta);
}

export function appliesToVenue(meta: WidgetMeta, venue: Venue): boolean {
  return meta.venues.includes(venue);
}

export function visibleRefs(
  refs: WidgetRef[],
  opts: { venue: Venue; role: "admin" | "staff"; overrides: VisibilityOverrides },
): WidgetRef[] {
  return refs.filter((r) => {
    const meta = CATALOG_BY_KEY.get(r.key);
    return !!meta && appliesToVenue(meta, opts.venue) && canSee(meta, opts.role, opts.overrides);
  });
}
