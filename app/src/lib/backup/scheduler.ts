import "server-only";

import { runBackup } from "./runBackup";

let armed = false;

/**
 * Arm a nightly (03:00 UTC) backup on the always-on server process. Re-arms
 * itself after each run. Single-instance only — never call this where more than
 * one replica runs (SQLite is single-writer and we never scale > 1 anyway).
 */
export function scheduleNightlyBackup(): void {
  if (armed) return;
  armed = true;

  const armNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(3, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    const ms = next.getTime() - now.getTime();
    setTimeout(() => {
      runBackup()
        .then((r) => console.log("[backup] nightly:", JSON.stringify(r)))
        .catch((e) => console.error("[backup] nightly failed:", e))
        .finally(armNext);
    }, ms);
  };

  armNext();
  console.log("[backup] nightly scheduler armed (03:00 UTC)");
}
