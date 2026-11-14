// app/src/lib/programs/access.ts
import "server-only";
import { redirect } from "next/navigation";

import { requireClientPage, type CurrentClient } from "@/lib/clientAuth";
import { db } from "@/lib/db";
import { programEnrolments } from "@/lib/db/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
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

/** The member's live program was set by their coach. */
function hasCoachSetProgram(clientId: number): boolean {
  return !!db
    .select({ id: programEnrolments.id })
    .from(programEnrolments)
    .where(and(eq(programEnrolments.clientId, clientId), inArray(programEnrolments.status, ["active", "paused"]), isNotNull(programEnrolments.assignedBy)))
    .get();
}

/** A member sees Programs where the module is on, in DIY mode or while their coach has set them a program. */
export function memberSeesPrograms(c: Pick<CurrentClient, "tenantId" | "client" | "clientId"> | null): boolean {
  if (!c || !programsOn(c.tenantId)) return false;
  return c.client.trainingMode === "diy" || hasCoachSetProgram(c.clientId);
}

/** Page guard for /app/programs: signed in, past the welcome steps, DIY, module on. */
export function requireProgramsPage(): CurrentClient {
  const c = requireClientPage();
  if (!memberSeesPrograms(c)) redirect("/app/workouts");
  return c;
}
