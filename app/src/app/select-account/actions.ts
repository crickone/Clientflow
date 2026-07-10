"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { setActiveTenant } from "@/lib/auth";

/**
 * Set the active clinic for the current session, then send the user to their
 * dashboard. `setActiveTenant` re-validates membership server-side, so this is
 * safe even though the tenant id comes from the client. On success it redirects
 * (never returns); on failure it returns the error for the UI to surface.
 */
export async function chooseAccount(
  tenantId: number,
): Promise<{ ok: false; error: string } | void> {
  const res = await setActiveTenant(tenantId);
  if (!res.ok) return res;
  // Every admin page is tenant-scoped and cached per route. Switching the active
  // clinic changes what the whole tree should render, so bust the Full Route +
  // client Router Cache — otherwise the previous clinic's cached pages are shown
  // after the switch (you pick Inspire but still see Renova until a hard reload).
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
