// app/src/lib/programs/registry.ts
/**
 * The platform program library, read from code. Programs are never copied
 * into a database, so a change here reaches every gym on the next deploy.
 * Gym copies live in the tenant DB (lib/programs/library.ts).
 */
import { greyskullLp } from "./templates/greyskull";
import { startingStrength } from "./templates/startingStrength";
import { strongLifts } from "./templates/stronglifts";
import type { ProgramTemplate } from "./types";

/** Every platform program, in the order the library lists them. */
export const PLATFORM_PROGRAMS: ProgramTemplate[] = [strongLifts, startingStrength, greyskullLp];

const BY_KEY = new Map(PLATFORM_PROGRAMS.map((t) => [t.key, t]));

export function platformProgram(key: string): ProgramTemplate | null {
  return BY_KEY.get(key) ?? null;
}
