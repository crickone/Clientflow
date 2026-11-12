"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { setTrainingMode } from "@/lib/programs/enrolments";
import { currentStaffActor } from "@/lib/programs/staffActor";

type Result = { ok: true } | { ok: false; error: string };

export async function setTrainingModeAction(clientId: number, mode: string): Promise<Result> {
  const actor = await currentStaffActor();
  if (!actor) return { ok: false, error: "Programs aren't switched on for this business." };
  const id = z.number().int().positive().safeParse(clientId);
  const m = z.enum(["coach", "diy"]).safeParse(mode);
  if (!id.success || !m.success) return { ok: false, error: "That change doesn't make sense." };
  if (!setTrainingMode(id.data, m.data, actor)) return { ok: false, error: "Member not found." };
  revalidatePath(`/clients/${id.data}`);
  return { ok: true };
}
