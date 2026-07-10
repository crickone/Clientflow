import "server-only";

import { recomputeLapsedAllTenants } from "./lapse";

let armed = false;

/**
 * Arm a daily (04:00 UTC) lapse recompute on the always-on server. Re-arms
 * after each run. Single-instance only (mirrors lib/backup/scheduler.ts).
 */
export function scheduleDailyLapse(): void {
  if (armed) return;
  armed = true;

  const armNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(4, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    const ms = next.getTime() - now.getTime();
    setTimeout(() => {
      try {
        const r = recomputeLapsedAllTenants();
        console.log("[pipeline] daily lapse:", JSON.stringify(r));
      } catch (e) {
        console.error("[pipeline] daily lapse failed:", e);
      } finally {
        armNext();
      }
    }, ms);
  };

  armNext();
  console.log("[pipeline] daily lapse scheduler armed (04:00 UTC)");
}
