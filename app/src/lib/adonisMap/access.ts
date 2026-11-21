// app/src/lib/adonisMap/access.ts
import "server-only";

import { isModuleOn } from "@/lib/features";
import { getFeatureFlagsForTenant } from "@/lib/settings";
import { ALL_MODULES, availableTypes, modulesFrom, type MapModules } from "./schema";
import type { TypeName } from "./types";

/** The business map is on for this business (its own switch and the platform rollout). Fails closed. */
export function mapEnabled(tenantId: number): boolean {
  try {
    return isModuleOn(getFeatureFlagsForTenant(tenantId), "adonis_map");
  } catch (err) {
    console.error("[adonisMap] module flags unreadable:", err);
    return false;
  }
}

/** Which modules shape the map. On a flag read failure every type shows; the map itself is still gated by mapEnabled. */
export function mapModules(tenantId: number): MapModules {
  try {
    return modulesFrom(getFeatureFlagsForTenant(tenantId));
  } catch (err) {
    console.error("[adonisMap] module flags unreadable, showing every type:", err);
    return ALL_MODULES;
  }
}

export function availableTypesFor(tenantId: number): TypeName[] {
  return availableTypes(mapModules(tenantId));
}
