import "server-only";

import { readKey, readKeyForTenant, setKey, deleteKey } from "@/lib/settings";
import { parseDesignSystem, type DesignSystem } from "./parse";

/**
 * The tenant's design system, read from and written to the existing settings
 * key/value table — no schema migration, the same store `theme` and
 * `venue_type` already live in.
 *
 * NULL IS A FIRST-CLASS STATE. A tenant with no design system keeps today's
 * Content Studio behaviour exactly: templates only, no composed layouts, no
 * validation notices. That is how Inspire and Renova stay working while
 * Optimal Health's system is the only one authored. Every caller must handle
 * null by falling through, never by substituting a default — a made-up design
 * system would put a brand's name on colours nobody chose.
 */

export const DESIGN_SYSTEM_KEY = "design_system";

export function getDesignSystem(): DesignSystem | null {
  return parseDesignSystem(readKey<unknown>(DESIGN_SYSTEM_KEY, null));
}

/**
 * Read for an EXPLICIT tenant rather than the request-scoped one — for
 * background work (the generation queue, schedulers) that has no cookie
 * context. Same fall-through-on-null contract.
 */
export function getDesignSystemForTenant(tenantId: number): DesignSystem | null {
  return parseDesignSystem(
    readKeyForTenant<unknown>(tenantId, DESIGN_SYSTEM_KEY, null),
  );
}

/**
 * Store a design system, or clear it with null. Round-trips through the
 * parser first, so a malformed system is rejected at the point someone tries
 * to save it rather than silently read back as null later.
 */
export function setDesignSystem(system: DesignSystem | null): boolean {
  if (system === null) {
    deleteKey(DESIGN_SYSTEM_KEY);
    return true;
  }
  const parsed = parseDesignSystem(system);
  if (!parsed) return false;
  setKey(DESIGN_SYSTEM_KEY, parsed);
  return true;
}
