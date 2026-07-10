"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdminPage } from "@/lib/auth";
import { fulfilRequest, setRequestStatus } from "@/lib/cms/requests";

export async function fulfilRequestAction(id: number) {
  await requireAdminPage();
  const res = await fulfilRequest(id);
  revalidatePath("/cms/requests");
  revalidatePath("/cms");
  if (res) redirect(`/cms/${res.siteSlug}`);
}

export async function declineRequestAction(id: number) {
  await requireAdminPage();
  setRequestStatus(id, "declined");
  revalidatePath("/cms/requests");
}

export async function reopenRequestAction(id: number) {
  await requireAdminPage();
  setRequestStatus(id, "new");
  revalidatePath("/cms/requests");
}
