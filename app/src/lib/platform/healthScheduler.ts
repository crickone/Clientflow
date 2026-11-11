import "server-only";

import { recordJobRun, pruneHistory } from "./jobRuns";
import { snapshotFleetHealth } from "./healthHistory";

let armed = false;
let running = false;

/**
 * Every hour, on the hour, plus once a minute after boot so a fresh deploy
 * has a row straight away. The same self-starting shape as the dispatch
 * ticker: a side-effect import from app/layout.tsx arms it once per process.
 */
async function runOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await recordJobRun("health_snapshot", "Health snapshot", () => snapshotFleetHealth());
    try {
      pruneHistory();
    } catch (err) {
      console.error("[health] prune failed:", err);
    }
  } catch (err) {
    console.error("[health] snapshot failed:", err);
  } finally {
    running = false;
  }
}

export function startHealthScheduler(): void {
  if (armed || process.env.NEXT_PHASE === "phase-production-build") return;
  armed = true;
  const boot = setTimeout(() => void runOnce(), 60 * 1000);
  boot.unref();
  const armNext = () => {
    const now = Date.now();
    const next = Math.ceil(now / 3600000) * 3600000;
    const t = setTimeout(() => {
      void runOnce().finally(armNext);
    }, next - now);
    t.unref();
  };
  armNext();
  console.log("[health] hourly snapshot scheduler armed");
}

startHealthScheduler();
