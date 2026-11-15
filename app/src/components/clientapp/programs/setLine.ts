// app/src/components/clientapp/programs/setLine.ts
/** One set as the session table writes it. Pure, so it can be tested on its own. */
import { repsLabel } from "@/lib/programs/planner";
import type { PlannedSet, WeightUnit } from "@/lib/programs/types";
import { formatWeight } from "@/lib/programs/units";

/** One set as the table writes it, weight first: "100 kg x 5", "about 140 kg x 3 · RPE 8", "3 reps · RPE 8", "12 reps". */
export function setLine(set: PlannedSet, unit: WeightUnit): string {
  // A drives set is a + set like an AMRAP one: the reps are a minimum.
  const reps = `${repsLabel(set)}${set.drives && !set.amrap ? "+" : ""}`;
  const load = set.kg !== null && set.kg > 0 ? formatWeight(set.kg, unit) : null;
  if (set.rpe !== null) return `${load ? `about ${load} x ${reps}` : `${reps} reps`} · RPE ${set.rpe}`;
  return load ? `${load} x ${reps}` : `${reps} reps`;
}
