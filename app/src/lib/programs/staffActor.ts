// app/src/lib/programs/staffActor.ts
import "server-only";

import { requireUser } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/db/tenant";
import { programsOn } from "./access";
import type { StaffActor } from "./enrolments";

/** The signed-in staff member as a change-log actor, or null when Programs is off for this business. */
export async function currentStaffActor(): Promise<StaffActor | null> {
  const user = await requireUser();
  if (!programsOn(getCurrentTenant().id)) return null;
  return { kind: "staff", userId: user.id, name: user.name?.trim() || user.email };
}
