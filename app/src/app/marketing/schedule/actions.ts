"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { cancelScheduledPost, normalizeChannels, schedulePost } from "@/lib/social/schedule";
import { unscheduleEmailCampaign } from "@/lib/marketing/schedule";

/**
 * Server actions for the Schedule page. Admin-only, like the page. Times
 * arrive as ISO instants from the browser (the operator's own clock), so
 * nothing here guesses a zone.
 */
export type ScheduleActionResult = { ok: true } | { ok: false; error: string };

function revalidate() {
  revalidatePath("/marketing/schedule");
  revalidatePath("/campaigns");
}

export async function schedulePostAction(input: {
  designId: number;
  whenIso: string;
  channels: string[];
}): Promise<ScheduleActionResult> {
  await requireAdmin();
  const designId = Number(input?.designId);
  if (!Number.isInteger(designId) || designId <= 0) return { ok: false, error: "Pick a design." };
  const when = new Date(String(input?.whenIso ?? ""));
  if (!Number.isFinite(when.getTime())) return { ok: false, error: "Pick a date and time." };
  const res = schedulePost({ carouselSetId: designId, scheduledFor: when, channels: normalizeChannels(input?.channels) });
  if (!res.ok) return res;
  revalidate();
  return { ok: true };
}

export async function cancelPostAction(id: number): Promise<ScheduleActionResult> {
  await requireAdmin();
  if (!Number.isInteger(id)) return { ok: false, error: "Invalid post." };
  const res = cancelScheduledPost(id);
  if (!res.ok) return res;
  revalidate();
  return { ok: true };
}

export async function unscheduleEmailAction(id: number): Promise<ScheduleActionResult> {
  await requireAdmin();
  if (!Number.isInteger(id)) return { ok: false, error: "Invalid campaign." };
  const res = unscheduleEmailCampaign(id);
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true };
}
