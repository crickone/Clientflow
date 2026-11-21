import type { PlatformFlag } from "@/lib/types";

export interface WhoHasIt {
  /** Plain text for a state with no chips ("All 5", "Nobody", "40% of businesses"). */
  text: string | null;
  /** Business names to show as chips (a named list), at most `max`. */
  names: string[];
  /** How many named businesses are not shown. */
  more: number;
}

/** The "Who has it" cell for one flag: pure, so the wording is tested. `nameOf` turns a business id into its name. */
export function whoHasIt(flag: PlatformFlag, total: number, nameOf: (id: number) => string, max = 4): WhoHasIt {
  if (flag.mode === "all") return { text: `All ${total}`, names: [], more: 0 };
  if (flag.mode === "none") return { text: "Nobody", names: [], more: 0 };
  if (flag.mode === "percent") return { text: `${flag.percent}% of businesses`, names: [], more: 0 };
  if (flag.allow.length === 0) return { text: "Nobody", names: [], more: 0 };
  const names = flag.allow.slice(0, max).map(nameOf);
  return { text: null, names, more: Math.max(0, flag.allow.length - max) };
}

/** Which segment of Everyone / Some / Nobody a flag sits in. A named list and a percentage are both "some". */
export function segmentOf(flag: PlatformFlag): "everyone" | "some" | "nobody" {
  if (flag.mode === "all") return "everyone";
  if (flag.mode === "none") return "nobody";
  // A named list with nobody on it gives the module to no one, so it reads as Nobody.
  if (flag.mode === "allow" && flag.allow.length === 0) return "nobody";
  return "some";
}

/**
 * How many businesses lose a module when `saved` becomes `next`. `tenantIds` is every business the Some panel can tick.
 * Returns 0 when nobody loses it (a widening or a no-op) and null when access narrows but the exact count cannot be
 * known (a percentage is chosen by a hash, so which businesses it covers is not listed here).
 */
export function lostCount(saved: PlatformFlag, next: PlatformFlag, tenantIds: number[]): number | null {
  const had = saved.mode === "all" ? "all" : saved.mode === "allow" ? saved.allow : saved.mode === "percent" ? "pct" : [];
  if (Array.isArray(had) && had.length === 0) return 0;
  if (next.mode === "none") return had === "all" ? tenantIds.length : Array.isArray(had) ? had.length : null;
  if (next.mode === "all") return 0;
  if (next.mode === "allow") {
    if (had === "all") return tenantIds.filter((id) => !next.allow.includes(id)).length;
    if (Array.isArray(had)) return had.filter((id) => !next.allow.includes(id)).length;
    return saved.percent <= 0 ? 0 : null;
  }
  // next is a percentage
  if (next.percent >= 100) return 0;
  if (had === "all") return next.percent <= 0 ? tenantIds.length : null;
  if (Array.isArray(had)) return next.percent <= 0 ? had.length : null;
  return next.percent >= saved.percent ? 0 : null;
}
