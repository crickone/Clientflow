import "server-only";

/**
 * The lead flows' clock. Every enrolment, check and dispatch reads the time
 * here, so the end-to-end tests can run a lead through weeks of flow on a
 * fixed date without waiting.
 */
let override: (() => number) | undefined;

export function flowNow(): number {
  return override ? override() : Date.now();
}

/** Tests only. */
export function setFlowClockForTests(fn: (() => number) | undefined): void {
  override = fn;
}
