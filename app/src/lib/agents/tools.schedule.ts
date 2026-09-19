import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getCampaign as getEmailCampaign, listCampaigns as listEmailCampaigns } from "@/lib/marketing/campaigns";
import { scheduleEmailCampaign, unscheduleEmailCampaign, listScheduledEmailCampaigns } from "@/lib/marketing/schedule";
import { cancelScheduledPost, listScheduledPosts, normalizeChannels, schedulePost } from "@/lib/social/schedule";
import { isMetaConnected } from "@/lib/social/publisher";
import { getCarousel } from "@/lib/image/carousels";
import { getSiteBlogPost, listSiteBlogPosts, setPublishState } from "@/lib/cms/blog";
import { resolveSite } from "@/lib/agents/tools.marketing";
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
    name: "schedule_blog_post",
    description:
      "Book a finished blog post to go live on the website at a date and time. The post stays invisible to visitors until then and publishes itself at that moment. Use this instead of publish_blog_post whenever the operator wants it live later — publish_blog_post puts it live immediately. Only schedule a time the operator has approved.",
    input_schema: {
      type: "object",
      properties: {
        postId: { type: "integer", description: "The blog post's id (from save_blog_post, or the campaign launch summary)." },
        when: { type: "string", description: "When to go live: YYYY-MM-DDTHH:mm in Irish local time (e.g. 2026-10-03T09:00), or a full ISO timestamp." },
        siteId: { type: "integer", description: "Optional: which website, when the business has more than one." },
      },
      required: ["postId", "when"],
    },
  },
  {
    name: "cancel_scheduled_item",
    description: "Take a scheduled social post, email send or blog post off the schedule. A cancelled email goes back to draft; a cancelled social post stays in Content Studio; a cancelled blog post goes back to a draft and stays unpublished.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["post", "email", "blog"] },
        id: { type: "integer", description: "For a social post: the scheduled post's id (from list_schedule). For an email: the email campaign's id. For a blog: the blog post's id." },
        name: { type: "string", description: "Optional: the item's name, purely for the approval card." },
      },
      required: ["kind", "id"],
    },
  },
  {
    name: "list_schedule",
    description:
      "Everything booked for a time, soonest first: scheduled social posts (with whether posting is connected yet), scheduled email sends, scheduled blog posts, and how many nurture-sequence messages are queued. Also lists email campaign drafts that could be scheduled. Use before scheduling, and to answer 'what's going out this week'.",
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

/**
 * WRITE -- book a blog post to go live at a time. Approve-gated.
 *
 * Same Irish-local `when` as the other two scheduling tools, deliberately:
 * an operator saying "Tuesday at 9" means the same thing whether they are
 * talking about an email, a post or a blog, and three different parsers
 * would eventually disagree about one of them.
 *
 * Refuses a time in the past rather than quietly publishing at once. A past
 * date would be picked up by the very next dispatch tick and go live within
 * the minute, which is publish_blog_post's job and not what anyone typing a
 * date is asking for.
 */
export function scheduleBlogPostTool(ctx: ToolContext, input: Record<string, unknown>): ToolResult {
  const postId = Number(input.postId);
  if (!postId) return { text: JSON.stringify({ error: "postId is required." }) };

  const when = parseWhen(input.when);
  if (!when) return { text: JSON.stringify({ error: "when must be YYYY-MM-DDTHH:mm (Irish time) or an ISO timestamp." }) };
  if (when.getTime() <= Date.now()) {
    return {
      text: JSON.stringify({
        error: `${formatDublin(when.getTime())} is in the past. Pick a future time, or use publish_blog_post to put it live now.`,
      }),
    };
  }

  const site = resolveSite(ctx, input.siteId);
  if ("error" in site) return site.error;

  const post = getSiteBlogPost(site.id, postId);
  if (!post) return { text: JSON.stringify({ error: `No blog post with id ${postId} on ${site.name}.` }) };
  if (post.publishState === "published") {
    return {
      text: JSON.stringify({
        error: `"${post.title}" is already live. Unpublish it first if it should go out at a different time.`,
      }),
    };
  }
  if (!post.content || !post.content.trim()) {
    return { text: JSON.stringify({ error: `"${post.title}" has no content yet — write it before scheduling it.` }) };
  }

  setPublishState(site.id, postId, "scheduled", when);
  return {
    text: JSON.stringify({
      result: `"${post.title}" will go live on ${site.name} at ${formatDublin(when.getTime())}. It stays hidden from visitors until then.`,
      postId,
      siteId: site.id,
      publishState: "scheduled",
      scheduledFor: when.toISOString(),
    }),
  };
}

/** WRITE -- unbook a post, an email send or a blog post. Approve-gated. */
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
  if (kind === "blog") {
    const site = resolveSite(_ctx, input.siteId);
    if ("error" in site) return site.error;
    const post = getSiteBlogPost(site.id, id);
    if (!post) return { text: JSON.stringify({ error: `No blog post with id ${id} on ${site.name}.` }) };
    if (post.publishState !== "scheduled") {
      return { text: JSON.stringify({ error: `"${post.title}" is not scheduled — nothing to cancel.` }) };
    }
    setPublishState(site.id, id, "draft");
    return { text: JSON.stringify({ result: `"${post.title}" is back to a draft and will not go live.` }) };
  }
  return { text: JSON.stringify({ error: 'kind must be "post", "email" or "blog".' }) };
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

  // Blog posts booked to go live, across every site this business has — the
  // schedule is a question about the business, not about one website, and a
  // tenant with two sites would otherwise be shown half its schedule.
  const scheduledBlogs = db
    .select({ id: schema.sites.id, name: schema.sites.name })
    .from(schema.sites)
    .all()
    .flatMap((site) =>
      listSiteBlogPosts(site.id)
        .filter((post) => post.publishState === "scheduled" && post.scheduledFor)
        .map((post) => ({
          blogPostId: post.id,
          title: post.title,
          site: site.name,
          siteId: site.id,
          when: formatDublin(post.scheduledFor!.getTime()),
          whenIso: post.scheduledFor!.toISOString(),
        })),
    )
    .sort((a, b) => a.whenIso.localeCompare(b.whenIso));

  return {
    text: JSON.stringify({
      postingConnected: isMetaConnected(ctx.tenantId),
      scheduledPosts: posts,
      scheduledEmails: emails,
      scheduledBlogs,
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
