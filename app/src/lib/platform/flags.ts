import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { MODULE_CATALOG, rolloutIncludes, type PlatformFlag } from "@/lib/features";

export function listPlatformFlags(): PlatformFlag[] {
  const rows = controlSqlite.prepare("SELECT key, mode, percent, allow FROM platform_flags").all() as Array<{ key: string; mode: PlatformFlag["mode"]; percent: number; allow: string }>;
  return MODULE_CATALOG.map((m) => {
    const r = rows.find((x) => x.key === m.key);
    let allow: number[] = [];
    try { allow = r ? (JSON.parse(r.allow) as number[]).filter((n) => Number.isInteger(n)) : []; } catch { allow = []; }
    return { key: m.key, mode: r?.mode ?? "all", percent: r?.percent ?? 100, allow };
  });
}

export function setPlatformFlag(flag: PlatformFlag): void {
  controlSqlite
    .prepare(
      `INSERT INTO platform_flags (key, mode, percent, allow, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET mode = excluded.mode, percent = excluded.percent, allow = excluded.allow, updated_at = excluded.updated_at`,
    )
    .run(flag.key, flag.mode, Math.max(0, Math.min(100, Math.round(flag.percent))), JSON.stringify(flag.allow.slice(0, 500)), Date.now());
}

export function rolloutCount(flag: PlatformFlag, tenantIds: number[]): number {
  return tenantIds.filter((id) => rolloutIncludes(flag, id)).length;
}
