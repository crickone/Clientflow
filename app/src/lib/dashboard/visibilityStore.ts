import "server-only";

import { readKey, setKey } from "@/lib/settings";
import { CATALOG } from "./catalog";
import type { Sensitivity, WidgetMeta } from "./types";
import type { VisibilityOverrides } from "./visibility";

/** Tenant settings key holding `{ [widgetKey]: staffCanSee }`. */
export const VISIBILITY_KEY = "dashboard_widget_visibility";

export function getVisibilityOverrides(): VisibilityOverrides {
  const v = readKey<unknown>(VISIBILITY_KEY, {});
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: VisibilityOverrides = {};
  for (const [k, b] of Object.entries(v as Record<string, unknown>)) if (typeof b === "boolean") out[k] = b;
  return out;
}

export function setWidgetVisibility(key: string, visible: boolean | null): void {
  const next = { ...getVisibilityOverrides() };
  if (visible === null) delete next[key];
  else next[key] = visible;
  setKey(VISIBILITY_KEY, next);
}

export function setSensitivityVisibility(sensitivities: Sensitivity[], visible: boolean): void {
  const next = { ...getVisibilityOverrides() };
  for (const m of CATALOG as readonly WidgetMeta[]) {
    if (sensitivities.includes(m.sensitivity)) next[m.key] = visible;
  }
  setKey(VISIBILITY_KEY, next);
}
