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

type VisOpts = { venue: Venue; role: "admin" | "staff"; overrides: VisibilityOverrides };

export function isRefVisible(ref: WidgetRef, opts: VisOpts): boolean {
  const meta = CATALOG_BY_KEY.get(ref.key);
  return !!meta && appliesToVenue(meta, opts.venue) && canSee(meta, opts.role, opts.overrides);
}

export function visibleRefs(refs: WidgetRef[], opts: VisOpts): WidgetRef[] {
  return refs.filter((r) => isRefVisible(r, opts));
}

/**
 * The submitted list with every stored ref the viewer could not see put back,
 * so a save from a restricted view never deletes widgets hidden from it. A
 * hidden ref stays right after the visible stored ref that preceded it (matched
 * by key and occurrence); leading hidden refs stay first; a hidden ref whose
 * predecessor was removed goes to the end. Unknown keys are dropped; a size the catalog no longer allows is clamped to the
 * widget's default size. Pure.
 */
export function mergeHiddenRefs(
  stored: WidgetRef[],
  submitted: WidgetRef[],
  isVisible: (ref: WidgetRef) => boolean,
): WidgetRef[] {
  const leading: WidgetRef[] = [];
  const after = new Map<string, WidgetRef[]>(); // "key#occurrence" -> hidden refs
  const seen = new Map<string, number>();
  let anchor: string | null = null;
  for (const stored0 of stored) {
    const meta = CATALOG_BY_KEY.get(stored0.key);
    if (!meta) continue;
    const ref = meta.sizes.includes(stored0.size) ? stored0 : { ...stored0, size: meta.defaultSize };
    if (isVisible(ref)) {
      const n = seen.get(ref.key) ?? 0;
      seen.set(ref.key, n + 1);
      anchor = `${ref.key}#${n}`;
    } else if (anchor === null) {
      leading.push(ref);
    } else {
      after.set(anchor, [...(after.get(anchor) ?? []), ref]);
    }
  }
  const out: WidgetRef[] = [...leading];
  const counts = new Map<string, number>();
  for (const ref of submitted) {
    out.push(ref);
    const n = counts.get(ref.key) ?? 0;
    counts.set(ref.key, n + 1);
    const id = `${ref.key}#${n}`;
    const hidden = after.get(id);
    if (hidden) {
      out.push(...hidden);
      after.delete(id);
    }
  }
  for (const rest of after.values()) out.push(...rest);
  return out;
}
