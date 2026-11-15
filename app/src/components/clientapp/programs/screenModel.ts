// app/src/components/clientapp/programs/screenModel.ts
/** Small decisions the member screens make, kept pure so they can be tested. */

export interface StripItem {
  label: string;
  value: string;
  sub?: string;
}

/** A stat strip never shows a zero: an item whose value is 0 is dropped, and the caller hides the strip when nothing is left. */
export function liveStripItems(items: (StripItem | null)[]): StripItem[] {
  return items.filter((it): it is StripItem => it !== null && it.value !== "0");
}

/** Workouts shows the "No program yet" row only when nothing runs and nothing is assigned: no coach plan, no assigned programs, no program of the member's own (running or paused). */
export function showsNoProgramRow(x: { coachPlan: boolean; assignedPrograms: number; enrolment: boolean }): boolean {
  return !x.coachPlan && x.assignedPrograms === 0 && !x.enrolment;
}
