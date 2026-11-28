// Pure helpers for the member app's week picker and training-days copy.
// A program is a flat list of days, each tagged with its week; the flat index
// is what Start, Continue and ?day= all use, so these helpers only map
// between weeks and flat indexes.

type DayLike = { week?: unknown; name: string };

function weekOf(d: { week?: unknown }): number {
  const w = d.week;
  return typeof w === "number" && Number.isInteger(w) && w >= 1 ? w : 1;
}

/** The distinct weeks, ascending. */
export function weekList(days: { week?: unknown }[]): number[] {
  return [...new Set(days.map(weekOf))].sort((a, b) => a - b);
}

/** Flat indexes of the days that belong to `week`, in order. */
export function dayIndexesInWeek(days: { week?: unknown }[], week: number): number[] {
  const out: number[] = [];
  days.forEach((d, i) => {
    if (weekOf(d) === week) out.push(i);
  });
  return out;
}

/** The week a flat day index sits in (1 when out of range). */
export function weekOfIndex(days: { week?: unknown }[], index: number): number {
  const d = days[index];
  return d ? weekOf(d) : 1;
}

/** Day tab text inside one week: the day's own name, else "Day N" counted within that week. */
export function tabLabelInWeek(days: DayLike[], week: number, index: number): string {
  let n = 0;
  for (let i = 0; i <= index; i++) if (weekOf(days[i]) === week) n++;
  return days[index].name.trim() || `Day ${n}`;
}

/** Text under the training-days picker about how program days map to training days. */
export function rotateMessage(
  program: { weeks: number; daysPerWeek: number | null; totalDays: number },
  picked: number,
): string {
  if (picked === 0) return "Pick the days you plan to train.";
  const plural = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
  if (program.weeks <= 1) {
    return picked !== program.totalDays
      ? `Your program has ${plural(program.totalDays)} and you picked ${picked}. The days run in order, so they will rotate across weeks.`
      : "Each training day gets the next day of your program, in order.";
  }
  const shape =
    program.daysPerWeek !== null
      ? `${program.weeks} weeks of ${plural(program.daysPerWeek)}`
      : `${program.weeks} weeks and ${plural(program.totalDays)}`;
  if (program.daysPerWeek !== null && picked === program.daysPerWeek) {
    return "Each training day gets the next day of your program, in order, week by week.";
  }
  return `Your program has ${shape} and you picked ${picked}. The days run in order, one program day for each training day.`;
}
