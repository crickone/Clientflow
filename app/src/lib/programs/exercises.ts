// app/src/lib/programs/exercises.ts
/**
 * The platform's canonical exercise names. Templates use these exactly; a
 * session matches them (and their aliases) to the gym's own exercise library
 * so the video and instructions show up. Pure.
 */
export interface CanonicalExercise {
  name: string;
  aliases: string[];
}

export const CANONICAL_EXERCISES: CanonicalExercise[] = [
  { name: "Back squat", aliases: ["Squat", "Barbell squat", "Barbell back squat"] },
  { name: "Front squat", aliases: ["Barbell front squat"] },
  { name: "Box squat", aliases: ["Barbell box squat"] },
  { name: "Pause squat", aliases: ["Paused squat", "Paused back squat"] },
  { name: "Bench press", aliases: ["Barbell bench press", "Flat bench press"] },
  { name: "Close-grip bench press", aliases: ["Close grip bench press"] },
  { name: "Pause bench press", aliases: ["Paused bench press", "Competition pause bench"] },
  { name: "Floor press", aliases: ["Barbell floor press"] },
  { name: "Pin press", aliases: ["Bench pin press"] },
  { name: "Incline bench press", aliases: ["Incline barbell bench press"] },
  { name: "Overhead press", aliases: ["Military press", "Barbell overhead press", "Standing press"] },
  { name: "Deadlift", aliases: ["Barbell deadlift", "Conventional deadlift"] },
  { name: "Sumo deadlift", aliases: [] },
  { name: "Romanian deadlift", aliases: ["RDL"] },
  { name: "Deficit deadlift", aliases: [] },
  { name: "Rack pull", aliases: ["Block pull"] },
  { name: "Stiff-legged deadlift", aliases: ["Stiff leg deadlift"] },
  { name: "Barbell row", aliases: ["Bent-over row", "Bent over row", "Barbell bent-over row"] },
  { name: "Pendlay row", aliases: [] },
  { name: "T-bar row", aliases: ["T bar row"] },
  { name: "Chest-supported row", aliases: ["Chest supported row", "Incline dumbbell row"] },
  { name: "Chin-up", aliases: ["Chin up", "Chinup"] },
  { name: "Pull-up", aliases: ["Pull up", "Pullup"] },
  { name: "Lat pulldown", aliases: ["Lat pull-down", "Wide-grip lat pulldown"] },
  { name: "Close-grip lat pulldown", aliases: [] },
  { name: "Seated cable row", aliases: ["Cable row"] },
  { name: "Dumbbell row", aliases: ["One-arm dumbbell row", "Single-arm dumbbell row"] },
  { name: "Dip", aliases: ["Dips", "Parallel bar dip"] },
  { name: "Barbell curl", aliases: ["Standing barbell curl"] },
  { name: "EZ-bar curl", aliases: ["EZ bar curl"] },
  { name: "Incline dumbbell curl", aliases: [] },
  { name: "Hammer curl", aliases: ["Dumbbell hammer curl"] },
  { name: "Preacher curl", aliases: [] },
  { name: "Concentration curl", aliases: [] },
  { name: "Spider curl", aliases: [] },
  { name: "Skull crusher", aliases: ["Lying triceps extension"] },
  { name: "Triceps pushdown", aliases: ["Tricep pushdown", "Cable pushdown"] },
  { name: "Overhead triceps extension", aliases: ["Seated triceps extension"] },
  { name: "Cable triceps kickback", aliases: ["Triceps kickback"] },
  { name: "Dumbbell bench press", aliases: ["Flat dumbbell press"] },
  { name: "Incline dumbbell press", aliases: ["Incline dumbbell bench press"] },
  { name: "Dumbbell fly", aliases: ["Flat dumbbell fly"] },
  { name: "Incline dumbbell fly", aliases: [] },
  { name: "Incline cable fly", aliases: [] },
  { name: "Cable crossover", aliases: ["Cable fly"] },
  { name: "Pec deck", aliases: ["Machine fly", "Pec deck fly"] },
  { name: "Machine chest press", aliases: ["Chest press"] },
  { name: "Seated dumbbell shoulder press", aliases: ["Dumbbell shoulder press"] },
  { name: "Upright row", aliases: [] },
  { name: "Lateral raise", aliases: ["Dumbbell lateral raise", "Side lateral raise"] },
  { name: "Rear delt fly", aliases: ["Reverse fly", "Bent-over lateral raise"] },
  { name: "Face pull", aliases: [] },
  { name: "Dumbbell shrug", aliases: [] },
  { name: "Barbell shrug", aliases: [] },
  { name: "Leg press", aliases: [] },
  { name: "Hip thrust", aliases: ["Barbell hip thrust"] },
  { name: "Hack squat", aliases: [] },
  { name: "Walking lunge", aliases: ["Barbell lunge", "Lunge"] },
  { name: "Bulgarian split squat", aliases: [] },
  { name: "Leg extension", aliases: [] },
  { name: "Lying leg curl", aliases: ["Leg curl"] },
  { name: "Seated leg curl", aliases: [] },
  { name: "Standing calf raise", aliases: ["Calf raise"] },
  { name: "Seated calf raise", aliases: [] },
  { name: "Leg press calf raise", aliases: ["Calf press"] },
  { name: "Donkey calf raise", aliases: [] },
  { name: "Back extension", aliases: ["Hyperextension"] },
  { name: "Good morning", aliases: [] },
  { name: "Hanging leg raise", aliases: [] },
  { name: "Cable crunch", aliases: [] },
  { name: "Plank", aliases: [] },
];

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

const BY_NAME = new Map<string, CanonicalExercise>();
for (const c of CANONICAL_EXERCISES) {
  BY_NAME.set(norm(c.name), c);
  for (const a of c.aliases) BY_NAME.set(norm(a), c);
}

/** Exactly a canonical name (templates must use these spellings). */
export function isCanonical(name: string): boolean {
  return CANONICAL_EXERCISES.some((c) => c.name === name);
}

/** The canonical exercise for a name or alias, any case. */
export function canonicalFor(name: string): CanonicalExercise | null {
  return BY_NAME.get(norm(name)) ?? null;
}

export function namesFor(name: string): string[] {
  const c = canonicalFor(name);
  return c ? [c.name, ...c.aliases] : [name];
}

/** The gym library exercise with this name or one of its aliases, if the gym has it. */
export function matchLibraryId(name: string, library: { id: number; name: string }[]): number | null {
  const wanted = new Set(namesFor(name).map(norm));
  return library.find((e) => wanted.has(norm(e.name)))?.id ?? null;
}
