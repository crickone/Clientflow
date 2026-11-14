// app/src/lib/programs/registry.ts
/**
 * The platform program library, read from code. Programs are never copied
 * into a database, so a change here reaches every gym on the next deploy.
 * Gym copies live in the tenant DB (lib/programs/library.ts).
 */
import { arnoldStyle } from "./templates/arnold";
import { calgaryStyle } from "./templates/calgary";
import { canditoStyle } from "./templates/candito";
import { conjugateStyle } from "./templates/conjugate";
import { dcStyle } from "./templates/dc";
import { fst7Style } from "./templates/fst7";
import { greyskullLp } from "./templates/greyskull";
import { germanVolumeTraining } from "./templates/gvt";
import { gzclp } from "./templates/gzclp";
import { hitStyle } from "./templates/hit";
import { juggernautStyle } from "./templates/juggernaut";
import { phat } from "./templates/phat";
import { phul } from "./templates/phul";
import { pushPullLegs } from "./templates/ppl";
import { rpStyle } from "./templates/rp";
import { russianSquatRoutine } from "./templates/rsr";
import { rtsStyle } from "./templates/rts";
import { sheikoStyle } from "./templates/sheiko";
import { smolovBase, smolovJrBench, smolovJrSquat } from "./templates/smolov";
import { startingStrength } from "./templates/startingStrength";
import { strongLifts } from "./templates/stronglifts";
import { texasMethod } from "./templates/texas";
import { upperLower } from "./templates/upperLower";
import { wendlerBbb, wendlerFsl } from "./templates/wendler";
import { y3tStyle } from "./templates/y3t";
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
  juggernautStyle,
  conjugateStyle,
  // powerlifting peaking
  smolovBase,
  smolovJrSquat,
  smolovJrBench,
  russianSquatRoutine,
  canditoStyle,
  sheikoStyle,
  rtsStyle,
  calgaryStyle,
  // bodybuilding and hypertrophy
  germanVolumeTraining,
  phul,
  phat,
  arnoldStyle,
  pushPullLegs,
  hitStyle,
  upperLower,
  rpStyle,
  y3tStyle,
  fst7Style,
  dcStyle,
];

const BY_KEY = new Map(PLATFORM_PROGRAMS.map((t) => [t.key, t]));

export function platformProgram(key: string): ProgramTemplate | null {
  return BY_KEY.get(key) ?? null;
}
