import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { MODULE_CATALOG, rolloutIncludes, type PlatformFlag } from "@/lib/features";

const MODES: ReadonlySet<PlatformFlag["mode"]> = new Set(["all", "none", "percent", "allow"]);

type FlagRow = { key: string; mode: string; percent: number; allow: string };

let listStmt: ReturnType<typeof controlSqlite.prepare<[], FlagRow>> | undefined;

function selectRows(): FlagRow[] {
  listStmt ??= controlSqlite.prepare<[], FlagRow>("SELECT key, mode, percent, allow FROM platform_flags");
  return listStmt.all();
}

export function listPlatformFlags(): PlatformFlag[] {
  const rows = selectRows();
  return MODULE_CATALOG.map((m) => {
    const r = rows.find((x) => x.key === m.key);
    // No row yet: the module's default rollout (everyone, unless the catalog
    // says a new module starts with nobody). A row with an unknown mode is
    // treated as "all", so an odd row can never switch a module off.
    const mode: PlatformFlag["mode"] = !r
      ? (m.defaultRollout ?? "all")
      : MODES.has(r.mode as PlatformFlag["mode"])
        ? (r.mode as PlatformFlag["mode"])
        : "all";
    let allow: number[] = [];
    if (r) {
      try {
        allow = (JSON.parse(r.allow) as number[]).filter((n) => Number.isInteger(n));
      } catch (err) {
        console.error("[flags] platform flag allow list unreadable:", m.key, err);
      }
    }
    return { key: m.key, mode, percent: r?.percent ?? 100, allow };
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
