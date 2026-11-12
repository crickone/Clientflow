// app/src/lib/programs/access.ts
import "server-only";
import { redirect } from "next/navigation";

import { requireClientPage, type CurrentClient } from "@/lib/clientAuth";
import { isModuleOn } from "@/lib/features";
import { getFeatureFlagsForTenant } from "@/lib/settings";

/** The Programs module is on for this business: its own switch and the platform rollout. Fails closed. */
export function programsOn(tenantId: number): boolean {
  try {
    return isModuleOn(getFeatureFlagsForTenant(tenantId), "programs");
  } catch (err) {
    console.error("[programs] module flags unreadable:", err);
    return false;
  }
}

/** A member sees Programs only in DIY mode, and only where the module is on. */
export function memberSeesPrograms(c: Pick<CurrentClient, "tenantId" | "client"> | null): boolean {
  return !!c && c.client.trainingMode === "diy" && programsOn(c.tenantId);
}

/** Page guard for /app/programs: signed in, past the welcome steps, DIY, module on. */
export function requireProgramsPage(): CurrentClient {
  const c = requireClientPage();
  if (!memberSeesPrograms(c)) redirect("/app/workouts");
  return c;
}
