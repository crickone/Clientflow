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
  return flag.mode === "all" ? "everyone" : flag.mode === "none" ? "nobody" : "some";
}
