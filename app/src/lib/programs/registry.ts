// app/src/lib/programs/registry.ts
/**
 * The platform program library, read from code. Programs are never copied
 * into a database, so a change here reaches every gym on the next deploy.
 * Gym copies live in the tenant DB (lib/programs/library.ts).
 */
import { arnoldStyle } from "./templates/arnold";
import { canditoStyle } from "./templates/candito";
import { greyskullLp } from "./templates/greyskull";
import { germanVolumeTraining } from "./templates/gvt";
import { gzclp } from "./templates/gzclp";
import { hitStyle } from "./templates/hit";
import { phat } from "./templates/phat";
import { phul } from "./templates/phul";
import { pushPullLegs } from "./templates/ppl";
import { russianSquatRoutine } from "./templates/rsr";
import { sheikoStyle } from "./templates/sheiko";
import { smolovBase, smolovJrBench, smolovJrSquat } from "./templates/smolov";
import { startingStrength } from "./templates/startingStrength";
import { strongLifts } from "./templates/stronglifts";
import { texasMethod } from "./templates/texas";
import { wendlerBbb, wendlerFsl } from "./templates/wendler";
import type { ProgramTemplate } from "./types";

/** Every platform program, in the order the library lists them. */
export const PLATFORM_PROGRAMS: ProgramTemplate[] = [
  // beginner linear
  strongLifts,
  startingStrength,
  greyskullLp,
  // strength cycles
  wendlerBbb,
  wendlerFsl,
  // nsunsStyle is left out on purpose: its second-lift rows and kg table are unchecked against the source.
  texasMethod,
  gzclp,
  // powerlifting peaking
  smolovBase,
  smolovJrSquat,
  smolovJrBench,
  russianSquatRoutine,
  canditoStyle,
  sheikoStyle,
  // bodybuilding and hypertrophy
  germanVolumeTraining,
  phul,
  phat,
  arnoldStyle,
  pushPullLegs,
  hitStyle,
];

const BY_KEY = new Map(PLATFORM_PROGRAMS.map((t) => [t.key, t]));

export function platformProgram(key: string): ProgramTemplate | null {
  return BY_KEY.get(key) ?? null;
}
