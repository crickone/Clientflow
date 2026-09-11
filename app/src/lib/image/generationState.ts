/**
 * The state of a DETACHED carousel generation, and the one judgement call that
 * goes with it. Pure -- no DB, no server-only import -- so it can be tested
 * without a tenant database, and so the same rule holds wherever the state is
 * read.
 */

/** 'writing' while a run is in flight, 'failed' when one gave up, null when idle. */
export type GenerationStatus = "writing" | "failed" | null;

/**
 * How long a run may claim to be running before the claim is treated as a lie.
 *
 * A run lives in the process that started it, so a deploy or a crash takes it
 * with it -- and the 'writing' left on the row would otherwise spin the editor
 * forever, waiting for a continuation that no longer exists. Generous on
 * purpose: a ten-slide design with a repair pass and ten renders is minutes of
 * work, and calling a live run dead is the worse of the two mistakes.
 */
export const GENERATION_STALE_MS = 15 * 60 * 1000;

export const GENERATION_LOST_MESSAGE =
  "The app restarted while these slides were being written. Generate again.";

export interface GenerationState {
  generationStatus: GenerationStatus;
  generationError: string | null;
  generationStartedAt: Date | null;
}

/**
 * Report a generation's state honestly: a 'writing' older than
 * GENERATION_STALE_MS is reported as the failure it actually is.
 *
 * Deliberately a READ-time correction rather than a write: a page load must not
 * mutate the design it is showing, and the row is put right by the next run.
 * A 'writing' with no start time at all predates the column and is likewise
 * dead -- nothing that started in this process is missing it.
 */
export function honestGenerationState(
  state: GenerationState,
  now: number = Date.now(),
): GenerationState {
  if (state.generationStatus !== "writing") return state;
  const started = state.generationStartedAt?.getTime();
  if (started !== undefined && now - started <= GENERATION_STALE_MS) return state;
  return {
    generationStatus: "failed",
    generationError: GENERATION_LOST_MESSAGE,
    generationStartedAt: state.generationStartedAt,
  };
}
