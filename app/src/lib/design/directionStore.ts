import "server-only";

import { deleteKey, readKey, setKey } from "@/lib/settings";
import { composeDesignSystem, type BrandPalette } from "./direction";
import { getDirection } from "./directions";
import { parseDesignSystem } from "./parse";
import { getDesignSystem, setDesignSystem } from "./system";

/**
 * A tenant's chosen direction and palette, and the act of applying them.
 *
 * Two keys, on purpose. `design_direction` holds the CHOICE -- which direction
 * and which hexes -- so the settings page can show it back and the operator
 * can adjust one swatch without re-choosing everything. `design_system` holds
 * the COMPOSED result, under the key the prompt, the audit and the renderer
 * already read; nothing downstream knows directions exist. Applying writes
 * both, atomically enough for a settings page: the composed system is written
 * last, so a failure part-way leaves the old system in place.
 *
 * A stored system with NO recorded choice is a hand-authored one (Optimal
 * Health today) and reads as "custom". This module never writes over it
 * unless an operator explicitly applies a direction.
 */

export const DESIGN_DIRECTION_KEY = "design_direction";

export interface StoredDirection {
  directionId: string;
  palette: BrandPalette;
}

export type DesignStatus =
  | { kind: "none" }
  | { kind: "custom" }
  | { kind: "direction"; directionId: string; palette: BrandPalette };

const HEX = /^#[0-9a-fA-F]{6}$/;

export function getStoredDirection(): StoredDirection | null {
  const raw = readKey<unknown>(DESIGN_DIRECTION_KEY, null);
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { directionId?: unknown; palette?: unknown };
  if (typeof o.directionId !== "string" || !getDirection(o.directionId)) return null;
  const palette: BrandPalette = {};
  if (o.palette && typeof o.palette === "object") {
    for (const [k, v] of Object.entries(o.palette as Record<string, unknown>)) {
      if (typeof v === "string" && HEX.test(v)) palette[k] = v.toLowerCase();
    }
  }
  return { directionId: o.directionId, palette };
}

export function designStatus(): DesignStatus {
  const stored = getStoredDirection();
  if (stored) return { kind: "direction", ...stored };
  return getDesignSystem() ? { kind: "custom" } : { kind: "none" };
}

/**
 * Compose and store. Refuses an unknown direction or a malformed hex and, on
 * refusal, changes nothing. Bounds-checked here, not in the route or the
 * action, so every caller gets the same guarantee.
 */
export function applyDesignDirection(
  directionId: string,
  palette: BrandPalette,
): { ok: true } | { ok: false; error: string } {
  const direction = getDirection(directionId);
  if (!direction) return { ok: false, error: "Unknown design direction." };

  const clean: BrandPalette = {};
  for (const slot of direction.slots) {
    const v = palette[slot.key];
    if (v === undefined) continue;
    if (typeof v !== "string" || !HEX.test(v.trim())) {
      return { ok: false, error: `"${slot.label}" needs a six-digit hex colour.` };
    }
    clean[slot.key] = v.trim().toLowerCase();
  }

  const system = parseDesignSystem(composeDesignSystem(direction, clean));
  if (!system) return { ok: false, error: "That combination doesn't compose to a valid design system." };

  setKey(DESIGN_DIRECTION_KEY, { directionId, palette: clean });
  setDesignSystem(system);
  return { ok: true };
}

/** Back to fixed templates: both the choice and the composed system go. */
export function clearDesignDirection(): void {
  deleteKey(DESIGN_DIRECTION_KEY);
  setDesignSystem(null);
}
