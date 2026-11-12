import "server-only";

import { recordJobRun, pruneHistory } from "./jobRuns";
import { snapshotFleetHealth } from "./healthHistory";
import { sendDailyDigest, sendInstantAlerts } from "./notify";

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
    try {
      await sendInstantAlerts();
    } catch (err) {
      console.error("[notify] instant alerts failed:", err);
    }
    try {
      await sendDailyDigest();
    } catch (err) {
      console.error("[notify] digest failed:", err);
    }
  } catch (err) {
    console.error("[health] snapshot failed:", err);
  } finally {
    running = false;
  }
}

export function startHealthScheduler(): void {
  const g = globalThis as { __adonisHealthScheduler?: boolean };
  if (armed || g.__adonisHealthScheduler || process.env.NEXT_PHASE === "phase-production-build") return;
  armed = true;
  g.__adonisHealthScheduler = true;
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
  // The hourly tick alone could miss 08:00 Dublin by up to 59 minutes.
  const digestTick = setInterval(() => void sendDailyDigest().catch((err) => console.error("[notify] digest:", err)), 10 * 60 * 1000);
  digestTick.unref();
  console.log("[health] hourly snapshot scheduler armed");
}

startHealthScheduler();
