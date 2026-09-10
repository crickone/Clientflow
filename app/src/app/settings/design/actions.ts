"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { applyDesignDirection, clearDesignDirection } from "@/lib/design/directionStore";

export type DesignActionResult = { ok: true } | { ok: false; error: string };

/**
 * Apply a direction with a palette. Deliberately NOT autosaved: this reshapes
 * every post the account generates from now on, and a misclick must not
 * silently reskin a brand. Validation lives in applyDesignDirection so a
 * script or a test gets the same guarantee as this button.
 */
export async function applyDesignDirectionAction(input: {
  directionId: string;
  palette: Record<string, string>;
}): Promise<DesignActionResult> {
  await requireAdmin();
  const r = applyDesignDirection(input.directionId, input.palette);
  if (r.ok) {
    revalidatePath("/settings/design");
    revalidatePath("/content-studio", "layout");
  }
  return r;
}

/** Back to fixed templates. */
export async function clearDesignDirectionAction(): Promise<DesignActionResult> {
  await requireAdmin();
  clearDesignDirection();
  revalidatePath("/settings/design");
  revalidatePath("/content-studio", "layout");
  return { ok: true };
}
