import "server-only";

import { BarListView } from "@/components/dashboard/views/BarListView";
import { CollectingNote } from "@/components/dashboard/views/CollectingNote";
import { kpi } from "@/components/dashboard/views/kpi";
import { RowList } from "@/components/dashboard/views/RowList";
import { SeriesChart } from "@/components/dashboard/views/SeriesChart";
import { getReach, getSocialAccounts, getSocialPosts, listFollowerRows, recordFollowerSnapshot } from "@/lib/social/metrics";
import { dayOf, followerChange, followerSeries, postTotals, topPosts } from "../metrics/social";
import { truncateText } from "../metrics/content";
import { deltaPct } from "../range";
import type { WidgetCtx, WidgetImpl } from "../types";
import { cached } from "./cache";
import type { SocialKey } from "./keys";

/**
 * Social widgets: live Meta numbers (lib/social/metrics, fail-soft and cached)
 * plus follower history from the daily snapshot. Opening the dashboard also
 * takes today's snapshot, so the history starts the first time anyone looks.
 */

const n = (v: number) => v.toLocaleString("en-IE");
const signed = (v: number) => `${v > 0 ? "+" : ""}${n(v)}`;
const SETTINGS = "/settings/integrations/facebook";

async function followerRows(ctx: WidgetCtx) {
  return cached(ctx, "social.followerRows", async () => {
    await recordFollowerSnapshot(ctx.tenantId).catch(() => undefined);
    return listFollowerRows(dayOf(ctx.range.fromMs - 400 * 86_400_000));
  });
}

const posts = (ctx: WidgetCtx, prev = false) => {
  const r = prev ? ctx.previous : ctx.range;
  return cached(ctx, `social.posts:${r.fromMs}:${r.toMs}`, () => getSocialPosts(ctx.tenantId, r.fromMs, r.toMs));
};

function followersTile(channel: "facebook" | "instagram") {
  return {
    href: SETTINGS,
    async load(ctx: WidgetCtx) {
      const accounts = await cached(ctx, "social.accounts", () => getSocialAccounts(ctx.tenantId));
      const live = channel === "facebook" ? accounts.facebook?.followers : accounts.instagram?.followers;
      if (channel === "instagram" && !accounts.instagram) return { value: "No Instagram linked", sub: "Link it to your Facebook Page" };
      if (live == null) return { value: "Not available", sub: "Meta did not report followers" };
      const c = followerChange(await followerRows(ctx), channel, dayOf(ctx.range.fromMs), dayOf(ctx.range.toMs - 1));
      return {
        value: n(live),
        sub: c?.change != null ? `${signed(c.change)} ${ctx.range.label.toLowerCase()}` : "Change shows once history builds up",
      };
    },
    render: kpi,
  };
}

export const SOCIAL_WIDGETS = {
  "social.fbFollowers": followersTile("facebook"),
  "social.igFollowers": followersTile("instagram"),
  "social.igReach": {
    href: SETTINGS,
    async load(ctx) {
      const [cur, prev] = await Promise.all([
        cached(ctx, `social.reach:${ctx.range.fromMs}`, () => getReach(ctx.tenantId, ctx.range.fromMs, ctx.range.toMs)),
        cached(ctx, `social.reach:${ctx.previous.fromMs}`, () => getReach(ctx.tenantId, ctx.previous.fromMs, ctx.previous.toMs)),
      ]);
      if (cur.instagramReach == null) return { value: "Not available", sub: "Needs a linked Instagram account" };
      return {
        value: n(cur.instagramReach),
        sub: cur.instagramProfileViews != null ? `${n(cur.instagramProfileViews)} profile views` : ctx.range.label,
        delta: prev.instagramReach != null ? deltaPct(cur.instagramReach, prev.instagramReach) : null,
      };
    },
    render: kpi,
  },
  "social.fbViews": {
    href: SETTINGS,
    async load(ctx) {
      const [cur, prev] = await Promise.all([
        cached(ctx, `social.reach:${ctx.range.fromMs}`, () => getReach(ctx.tenantId, ctx.range.fromMs, ctx.range.toMs)),
        cached(ctx, `social.reach:${ctx.previous.fromMs}`, () => getReach(ctx.tenantId, ctx.previous.fromMs, ctx.previous.toMs)),
      ]);
      if (cur.facebookViews == null) return { value: "Not available", sub: "Meta did not report Page views" };
      return { value: n(cur.facebookViews), sub: ctx.range.label, delta: prev.facebookViews != null ? deltaPct(cur.facebookViews, prev.facebookViews) : null };
    },
    render: kpi,
  },
  "social.engagement": {
    href: SETTINGS,
    async load(ctx) {
      const [cur, prev] = await Promise.all([posts(ctx), posts(ctx, true)]);
      const t = postTotals(cur);
      const p = postTotals(prev);
      return {
        value: n(t.engagement),
        sub: `${t.posts} ${t.posts === 1 ? "post" : "posts"}${t.average != null ? `, ${t.average} each` : ""}`,
        delta: deltaPct(t.engagement, p.engagement),
      };
    },
    render: kpi,
  },
  "social.followerTrend": {
    href: SETTINGS,
    async load(ctx) {
      const rows = await followerRows(ctx);
      return { data: followerSeries(rows, dayOf(ctx.range.fromMs), dayOf(ctx.range.toMs - 1)), since: ctx.recorderStart("social_followers") };
    },
    render: (d: { data: Array<Record<string, string | number>>; since: Date | null }) => (
      <div>
        <CollectingNote since={d.since} />
        {d.data.length < 2 ? (
          <div style={{ padding: "16px 0", color: "var(--text-tertiary)", fontSize: 14 }}>The chart fills in as a count is taken each day.</div>
        ) : (
          <SeriesChart
            data={d.data}
            xKey="label"
            series={[
              { key: "facebook", label: "Facebook", color: "var(--accent)" },
              { key: "instagram", label: "Instagram", color: "var(--text-tertiary)" },
            ]}
          />
        )}
      </div>
    ),
  },
  "social.topPosts": {
    href: SETTINGS,
    async load(ctx) {
      return topPosts(await posts(ctx), 6).map((p) => ({
        id: `${p.channel}:${p.id}`,
        primary: truncateText(p.text, 90) || (p.channel === "instagram" ? "Instagram post" : "Facebook post"),
        secondary: `${p.channel === "instagram" ? "Instagram" : "Facebook"} · ${n(p.likes)} likes · ${n(p.comments)} comments${p.channel === "facebook" ? ` · ${n(p.shares)} shares` : ""}`,
        meta: new Date(p.createdAt).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "Europe/Dublin" }),
        href: p.permalink ?? undefined,
      }));
    },
    render: (rows) => <RowList rows={rows} empty="No posts published in this period." />,
  },
  "social.byChannel": {
    href: SETTINGS,
    async load(ctx) {
      const t = postTotals(await posts(ctx));
      return (["facebook", "instagram"] as const).map((c) => ({
        label: c === "facebook" ? "Facebook" : "Instagram",
        value: t.byChannel[c].engagement,
        display: `${n(t.byChannel[c].engagement)} from ${t.byChannel[c].posts} ${t.byChannel[c].posts === 1 ? "post" : "posts"}`,
      }));
    },
    render: (rows: { label: string; value: number; display: string }[]) => (
      <BarListView rows={rows.some((r) => r.value > 0) ? rows : []} empty="No engagement on posts in this period." />
    ),
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<SocialKey, WidgetImpl<any>>;
