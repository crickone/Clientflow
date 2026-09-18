import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getCampaign as getEmailCampaign, listCampaigns as listEmailCampaigns } from "@/lib/marketing/campaigns";
import { scheduleEmailCampaign, unscheduleEmailCampaign, listScheduledEmailCampaigns } from "@/lib/marketing/schedule";
import { cancelScheduledPost, listScheduledPosts, normalizeChannels, schedulePost } from "@/lib/social/schedule";
import { isMetaConnected } from "@/lib/social/publisher";
import { getCarousel } from "@/lib/image/carousels";
import type { ToolContext, ToolResult } from "@/lib/agents/toolKit";

/**
 * Scheduling from the chat: book a post or an email send for a time the
 * operator approved, see what is booked, cancel a booking.
 *
 *   schedule_social_post    WRITE  a Content Studio design -> scheduled_posts
 *                                  (lib/social/schedule). Posts when the Meta
 *                                  connection exists; waits, labelled, until
 *                                  then.
 *   schedule_email_campaign WRITE  an email campaign draft -> "scheduled"
 *                                  with a send time (lib/marketing/schedule);
 *                                  the ticker runs the real precheck + send.
 *   cancel_scheduled_item   WRITE  unbook either.
 *   list_schedule           READ   everything booked, soonest first, plus the
 *                                  nurture queue size and whether posting is
 *                                  connected yet.
 *
 * Times: the model is asked for "YYYY-MM-DDTHH:mm" in Irish local time, or a
 * full ISO string with an offset. A bare local time is resolved in
 * Europe/Dublin, never in the server's zone (Railway runs UTC), because an
 * operator who says "9am" means their 9am.
 */
export type { ToolContext, ToolResult };

const DUBLIN = "Europe/Dublin";

/** Offset of Europe/Dublin from UTC at `utcMs`, in minutes (0 in winter, 60 in summer). */
function dublinOffsetMinutes(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-IE", {
    timeZone: DUBLIN,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - utcMs) / 60_000);
}

/** Parse the tool's time argument. A bare "YYYY-MM-DDTHH:mm" is Irish local time. */
export function parseWhen(raw: unknown): Date | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const bare = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (bare) {
    const [, y, mo, d, h, mi, sec] = bare;
    const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec ?? "0"));
    // Two passes: the offset at the naive instant, then re-read at the
    // corrected instant, so a time on a clock-change day still lands right.
    let utc = naive - dublinOffsetMinutes(naive) * 60_000;
    utc = naive - dublinOffsetMinutes(utc) * 60_000;
    return new Date(utc);
  }
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function formatDublin(ms: number): string {
  return new Intl.DateTimeFormat("en-IE", {
    timeZone: DUBLIN,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
}

// ─── Tool schemas (what the model sees) ──────────────────────────────────────

export const SCHEDULE_TOOLS: Anthropic.Tool[] = [
  {
    name: "schedule_social_post",
    description:
      "Book a finished Content Studio post (from create_social_post / list_social_posts) to go out on Facebook and/or Instagram at a date and time. The post is published automatically at that time once the Facebook connection is live; until Meta's app review completes it waits in the schedule, clearly labelled, and goes out the moment the connection exists. Only schedule posts the operator has approved the time for.",
    input_schema: {
      type: "object",
      properties: {
        postId: { type: "integer", description: "The design's id (list_social_posts / create_social_post)." },
        when: { type: "string", description: "When to post: YYYY-MM-DDTHH:mm in Irish local time (e.g. 2026-10-03T12:00), or a full ISO timestamp." },
        channels: { type: "array", items: { type: "string", enum: ["facebook", "instagram"] }, description: "Default both." },
        campaignId: { type: "integer", description: "Optional: the campaign this post belongs to." },
        name: { type: "string", description: "Optional: the post's name, purely for the approval card." },
      },
      required: ["postId", "when"],
    },
  },
  {
    name: "schedule_email_campaign",
    description:
      "Book an email campaign draft (e.g. one of a launched campaign kit's three emails, ids from launch_campaign; or any draft in Email campaigns) to send at a date and time. At that time the real send runs with its usual checks (verified sending domain, credits, audience); if a check fails the campaign goes back to draft with the reason recorded. Only schedule a send the operator has approved the time for.",
    input_schema: {
      type: "object",
      properties: {
        emailCampaignId: { type: "integer", description: "The email campaign's id." },
        when: { type: "string", description: "When to send: YYYY-MM-DDTHH:mm in Irish local time, or a full ISO timestamp." },
        name: { type: "string", description: "Optional: the email's name, purely for the approval card." },
      },
      required: ["emailCampaignId", "when"],
    },
  },
  {
    name: "cancel_scheduled_item",
    description: "Take a scheduled post or a scheduled email send off the schedule. A cancelled email goes back to draft; a cancelled post stays in Content Studio.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["post", "email"] },
        id: { type: "integer", description: "For a post: the scheduled post's id (from list_schedule). For an email: the email campaign's id." },
        name: { type: "string", description: "Optional: the item's name, purely for the approval card." },
      },
      required: ["kind", "id"],
    },
  },
  {
    name: "list_schedule",
    description:
      "Everything booked for a time, soonest first: scheduled social posts (with whether posting is connected yet), scheduled email sends, and how many nurture-sequence messages are queued. Also lists email campaign drafts that could be scheduled. Use before scheduling, and to answer 'what's going out this week'.",
    input_schema: { type: "object", properties: {} },
  },
];

// ─── Executors ───────────────────────────────────────────────────────────────

/** WRITE -- book a design for a time. Approve-gated. */
export function scheduleSocialPostTool(ctx: ToolContext, input: Record<string, unknown>): ToolResult {
  const postId = Number(input.postId);
  if (!postId) return { text: JSON.stringify({ error: "postId is required." }) };
  const when = parseWhen(input.when);
  if (!when) return { text: JSON.stringify({ error: "when must be YYYY-MM-DDTHH:mm (Irish time) or an ISO timestamp." }) };
  const campaignIdArg = Number(input.campaignId);
  const campaignId = Number.isInteger(campaignIdArg) && campaignIdArg > 0 ? campaignIdArg : null;

  const res = schedulePost({
    carouselSetId: postId,
    scheduledFor: when,
    channels: normalizeChannels(input.channels),
    campaignId,
  });
  if (!res.ok) return { text: JSON.stringify({ error: res.error }) };

  const connected = isMetaConnected(ctx.tenantId);
  return {
    text: JSON.stringify({
      result: `Scheduled "${res.post.designName}" for ${formatDublin(res.post.scheduledFor)} on ${res.post.channels.join(" and ")}.${connected ? "" : " Facebook is not connected yet (Meta app review in progress): the post waits in the schedule and goes out automatically once it is."}`,
      scheduledPostId: res.post.id,
      postId,
      scheduledFor: new Date(res.post.scheduledFor).toISOString(),
      channels: res.post.channels,
      postingConnected: connected,
    }),
  };
}

/** WRITE -- book an email campaign's send. Approve-gated. */
export function scheduleEmailCampaignTool(_ctx: ToolContext, input: Record<string, unknown>): ToolResult {
  const id = Number(input.emailCampaignId);
  if (!id) return { text: JSON.stringify({ error: "emailCampaignId is required." }) };
  const when = parseWhen(input.when);
  if (!when) return { text: JSON.stringify({ error: "when must be YYYY-MM-DDTHH:mm (Irish time) or an ISO timestamp." }) };
  const res = scheduleEmailCampaign(id, when);
  if (!res.ok) return { text: JSON.stringify({ error: res.error }) };
  return {
    text: JSON.stringify({
      result: `"${res.campaign.name}" will send on ${formatDublin(when.getTime())}. The usual checks (verified domain, credits, audience) run at send time; if one fails it goes back to draft with the reason.`,
      emailCampaignId: id,
      scheduledFor: when.toISOString(),
      status: res.campaign.status,
    }),
  };
}

/** WRITE -- unbook a post or an email send. Approve-gated. */
export function cancelScheduledItemTool(_ctx: ToolContext, input: Record<string, unknown>): ToolResult {
  const kind = String(input.kind || "");
  const id = Number(input.id);
  if (!id) return { text: JSON.stringify({ error: "id is required." }) };
  if (kind === "post") {
    const res = cancelScheduledPost(id);
    return { text: JSON.stringify(res.ok ? { result: `Scheduled post #${id} cancelled; the design is still in Content Studio.` } : { error: res.error }) };
  }
  if (kind === "email") {
    const res = unscheduleEmailCampaign(id);
    return { text: JSON.stringify(res.ok ? { result: `"${res.campaign.name}" is back to a draft and will not send.` } : { error: res.error }) };
  }
  return { text: JSON.stringify({ error: 'kind must be "post" or "email".' }) };
}

/** READ -- the whole schedule. */
export function listScheduleTool(ctx: ToolContext, _input: Record<string, unknown>): ToolResult {
  const posts = listScheduledPosts().map((p) => ({
    scheduledPostId: p.id,
    postId: p.carouselSetId,
    name: p.designName,
    when: formatDublin(p.scheduledFor),
    whenIso: new Date(p.scheduledFor).toISOString(),
    channels: p.channels,
    status: p.status,
    note: p.error,
    slides: p.slideCount,
  }));
  const emails = listScheduledEmailCampaigns().map((c) => ({
    emailCampaignId: c.id,
    name: c.name,
    subject: c.subject,
    when: c.scheduledAt ? formatDublin(c.scheduledAt) : null,
    whenIso: c.scheduledAt ? new Date(c.scheduledAt).toISOString() : null,
  }));
  const drafts = listEmailCampaigns()
    .filter((c) => c.status === "draft")
    .slice(0, 20)
    .map((c) => ({ emailCampaignId: c.id, name: c.name, subject: c.subject }));
  const queued =
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.automationQueue)
      .where(and(eq(schema.automationQueue.status, "queued")))
      .get()?.n ?? 0;
  const nextNurture = db
    .select({ dueAt: schema.automationQueue.dueAt })
    .from(schema.automationQueue)
    .where(eq(schema.automationQueue.status, "queued"))
    .orderBy(asc(schema.automationQueue.dueAt))
    .limit(1)
    .get();

  return {
    text: JSON.stringify({
      postingConnected: isMetaConnected(ctx.tenantId),
      scheduledPosts: posts,
      scheduledEmails: emails,
      emailDraftsAvailable: drafts,
      nurtureQueue: { queued, next: nextNurture ? formatDublin(nextNurture.dueAt.getTime()) : null },
      note: "Times are Irish local time. A post with a note is waiting on the Facebook connection.",
    }),
  };
}

/** Whether a design exists and is ready -- used by the launch tool's suggestions. */
export function designSummary(id: number): { id: number; name: string; ready: boolean } | null {
  const c = getCarousel(id);
  if (!c) return null;
  return { id: c.id, name: c.name, ready: c.generationStatus == null && c.slides.length > 0 };
}

/** Name lookup for the approval card. */
export function emailCampaignName(id: number): string | null {
  return getEmailCampaign(id)?.name ?? null;
}
