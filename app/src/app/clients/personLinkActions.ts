"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { mapEnabled } from "@/lib/adonisMap/access";
import { setDecision } from "@/lib/adonisMap/decisions";
import { requireUser } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/db/tenant";
import { logActivity } from "@/lib/queries";

type Result = { ok: true } | { ok: false; error: string };
const idZ = z.number().int().positive();

/** Staff decide whether a lead and a client are the same person. Unlink is a "separate" decision on the pair. */
export async function decidePersonLink(leadId: number, clientId: number, decision: string): Promise<Result> {
  const user = await requireUser();
  const tenant = getCurrentTenant();
  if (!mapEnabled(tenant.id)) return { ok: false, error: "The business map isn't switched on for this business." };
  const l = idZ.safeParse(leadId);
  const c = idZ.safeParse(clientId);
  const d = z.enum(["join", "separate"]).safeParse(decision);
  if (!l.success || !c.success || !d.success) return { ok: false, error: "That change doesn't make sense." };
  if (!setDecision(tenant.id, l.data, c.data, d.data, user.id)) return { ok: false, error: "That lead or client no longer exists." };
  await logActivity(
    "person_link",
    `${d.data === "join" ? "Joined" : "Kept separate"} lead #${l.data} and client #${c.data}`,
    { leadId: l.data, clientId: c.data, decision: d.data, userId: user.id },
  );
  revalidatePath(`/clients/${c.data}`);
  revalidatePath(`/leads/${l.data}`);
  return { ok: true };
}
