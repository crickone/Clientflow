import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { getTenantDbById } from "@/lib/db/tenant";
import { sites } from "@/lib/db/schema";
import { draftBlogPost } from "@/lib/ai/draftBlog";
import { generateCarouselSlides } from "@/lib/ai/generateCarousel";
import { assertUnderCap, recordUsage } from "@/lib/ai/usage";
import {
  createSiteBlogPost,
  getSiteBlogPost,
  listSiteBlogPosts,
  setPublishState,
  updateBlogMeta,
} from "@/lib/cms/blog";
import { updateBlogContent } from "@/lib/blog/posts";

/**
 * Marketing-agent tools (Marketing Task 1): draft/list/save/publish blog posts
 * + draft carousels. Wraps EXISTING content generators (`draftBlogPost`,
 * `generateCarouselSlides`) and the EXISTING CMS blog persistence
 * (`@/lib/cms/blog`) — no new infrastructure (no social posting, no
 * scheduler, no review-requests). Registered into the central tool registry
 * by `@/lib/assistant/tools` (TOOLS/executeTool/WRITE_TOOLS/
 * summarizeToolAction), exactly like the sales tools in `tools.sales.ts`.
 *
 * `ToolContext`/`ToolResult`/`tdb` below are deliberately LOCAL,
 * structurally-identical copies of the ones in `@/lib/assistant/tools`
 * rather than imports from it — same circular-dependency reason documented
 * in `tools.sales.ts`: that file imports THIS module's schemas and executors
 * to register them, so importing back from it here would cycle. TypeScript's
 * structural typing makes these interchangeable at every call site.
 *
 * Metering (IMPORTANT): `draftBlogPost` and `generateCarouselSlides`
 * construct their OWN `Anthropic` client and call `claude-opus-4-7` directly
 * — they do NOT go through the shared metered `getAnthropic()` client, so
 * they'd otherwise dodge the tenant's monthly AI cap entirely. Both
 * generator-calling tools below therefore meter at the TOOL boundary:
 * `assertUnderCap` before the call, `recordUsage(tenantId, "marketing",
 * "claude-opus-4-7", usage)` after — mapping the generator's returned usage
 * shape to the shared metering `Usage` shape via `toMeteredUsage`.
 * `claude-opus-4-7` is mirrored into `PRICING` in `@/lib/ai/client.ts` (same
 * rates as `claude-opus-4-8`) so `estCostCents` prices it correctly.
 */
type ToolArtifact = { url: string; filename: string; label: string };
export type ToolResult = { text: string; artifact?: ToolArtifact };
export type ToolContext = { tenantId: number; userId?: number };

function tdb(ctx: ToolContext) {
  return getTenantDbById(ctx.tenantId);
}

// Must match the literal model id `draftBlogPost`/`generateCarouselSlides`
// call internally (see @/lib/ai/draftBlog.ts, @/lib/ai/generateCarousel.ts).
const MARKETING_MODEL = "claude-opus-4-7";

type GeneratorUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};

/** Map a content generator's usage shape (BlogDraftResult/GenerateResult) to the shared metering Usage shape. */
function toMeteredUsage(u: GeneratorUsage) {
  return {
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheReadTokens: u.cacheReadInputTokens,
    cacheCreateTokens: u.cacheCreationInputTokens,
  };
}

type ResolvedSite = { id: number; name: string; slug: string };
type SiteResolution = ResolvedSite | { error: ToolResult };

/**
 * Blogs are site-scoped (a tenant's CMS may manage more than one site), so
 * every blog tool first needs to know WHICH site it's acting on:
 *   1. an explicit siteId — validated against THIS tenant's own `sites`
 *      table (queried via tdb(ctx)). Each tenant has its own physically
 *      separate SQLite file, so a siteId belonging to a different tenant
 *      simply will not appear among these rows — that's the cross-tenant
 *      guard, structural rather than a filter that could be forgotten.
 *   2. no siteId given, and the tenant has exactly one site — use it (the
 *      common case: most tenants manage a single business site).
 *   3. anything else (zero sites, or more than one with none specified) —
 *      never guess; return an error result listing the tenant's sites so the
 *      agent can ask the operator which one.
 */
export function resolveSite(ctx: ToolContext, siteId?: unknown): SiteResolution {
  const db = tdb(ctx);
  const rows = db
    .select({ id: sites.id, name: sites.name, slug: sites.slug })
    .from(sites)
    .all();

  const wanted = Number(siteId);
  const hasWanted =
    siteId !== undefined && siteId !== null && siteId !== "" && Number.isFinite(wanted) && wanted > 0;

  if (hasWanted) {
    const match = rows.find((s) => s.id === wanted);
    if (match) return match;
    return {
      error: {
        text: JSON.stringify({
          error: `No site with id ${wanted} for this tenant.`,
          availableSites: rows,
        }),
      },
    };
  }

  if (rows.length === 1) return rows[0];

  return {
    error: {
      text: JSON.stringify({
        error:
          rows.length === 0
            ? "This tenant has no sites yet — create one in the CMS first."
            : "This tenant manages multiple sites — specify siteId.",
        availableSites: rows,
      }),
    },
  };
}

// ─── Tool schemas (what the model sees) ──────────────────────────────────────

export const MARKETING_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_blog_posts",
    description:
      "List a site's blog posts (id, title, publish state, published date), most recent first. Use to see what's already drafted/published before writing something new, or to find a postId to pass to publish_blog_post.",
    input_schema: {
      type: "object",
      properties: {
        siteId: { type: "integer", description: "The site's id. Omit if the tenant only manages one site." },
      },
    },
  },
  {
    name: "draft_blog_post",
    description:
      "Draft a blog post from a title and topic. Returns ONLY a markdown draft — it does NOT save or publish anything. Show the draft to the operator and get explicit approval before calling save_blog_post.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "The post's title." },
        topic: { type: "string", description: "What the post should be about / the angle to take." },
        tone: { type: "string", description: "Optional tone notes, e.g. 'warm, reassuring'." },
        targetWords: { type: "integer", description: "Target word count (default 700)." },
      },
      required: ["title", "topic"],
    },
  },
  {
    name: "save_blog_post",
    description:
      "Save a blog post as a DRAFT on a site — persisted but NOT visible to the public. Use once the operator has approved specific content (e.g. from draft_blog_post, or text they gave you directly). Does NOT publish — call publish_blog_post separately when the operator is ready to go live.",
    input_schema: {
      type: "object",
      properties: {
        siteId: { type: "integer", description: "The site's id. Omit if the tenant only manages one site." },
        title: { type: "string" },
        content: { type: "string", description: "Full markdown body of the post." },
        excerpt: { type: "string", description: "Optional short summary shown on list/preview cards." },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "publish_blog_post",
    description:
      "Publish an already-saved draft blog post to the LIVE public site — visible to every visitor immediately. ONLY call this when the operator has explicitly asked to publish/go live; confirm which post first.",
    input_schema: {
      type: "object",
      properties: {
        siteId: { type: "integer", description: "The site's id. Omit if the tenant only manages one site." },
        postId: { type: "integer", description: "The blog post's id (see list_blog_posts)." },
      },
      required: ["postId"],
    },
  },
  {
    name: "draft_carousel",
    description:
      "Draft an Instagram/Facebook carousel (slide headings/bodies + a caption) on a topic. Returns ONLY a draft — it does NOT post or save anything; the operator refines and exports it in Content Studio.",
    input_schema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "What the carousel is about." },
        slideCount: { type: "integer", description: "Number of slides, 2-10 (default 5)." },
        tone: { type: "string", description: "Optional tone notes." },
      },
      required: ["topic"],
    },
  },
];

// ─── Executors ───────────────────────────────────────────────────────────────
// list_blog_posts is a READ but — like every helper in @/lib/cms/blog — has
// no explicit-db variant; it always queries via the ambient request-scoped
// `db` (@/lib/db). save_blog_post/publish_blog_post are WRITEs that go
// through the same ambient-tenant CMS blog libs, mirroring how the sales
// agent's write tools (sendWhatsappTool et al in tools.sales.ts) use
// ambient-tenant libs. Safe because every call site that invokes executeTool
// for a tenant's tools (/api/assistant/chat, /api/assistant/execute,
// /api/agents/[key]/chat) always wraps the call in runWithTenant(ctx.tenantId,
// ...) first, so the ambient tenant is guaranteed to equal ctx.tenantId.
// Tests must reproduce that wrapping (see tools.marketing.test.ts).
// resolveSite itself queries tdb(ctx) explicitly (not ambient) — the
// cross-tenant guard doesn't rely on the ambient wrapping being correct.

/** READ — list a site's blog posts (title, publish state, published date). */
export function listBlogPostsTool(ctx: ToolContext, input: Record<string, unknown>): ToolResult {
  const site = resolveSite(ctx, input.siteId);
  if ("error" in site) return site.error;

  const rows = listSiteBlogPosts(site.id).slice(0, 30);
  return {
    text: JSON.stringify({
      siteId: site.id,
      siteName: site.name,
      count: rows.length,
      posts: rows.map((p) => ({
        id: p.id,
        title: p.title,
        publishState: p.publishState,
        publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
      })),
    }),
  };
}

/** READ — draft a blog post from a title+topic via the real draftBlogPost generator. Performs NO persistence. */
export async function draftBlogPostTool(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  const title = String(input.title || "").trim();
  const topic = String(input.topic || "").trim();
  if (!title) return { text: JSON.stringify({ error: "title is required." }) };
  if (!topic) return { text: JSON.stringify({ error: "topic is required." }) };
  const tone = input.tone != null ? String(input.tone).trim() || null : null;
  const targetWordsArg = Number(input.targetWords);
  const targetWords =
    Number.isFinite(targetWordsArg) && targetWordsArg > 0
      ? Math.min(3000, Math.max(100, Math.round(targetWordsArg)))
      : 700;

  try {
    assertUnderCap(ctx.tenantId);
    const draft = await draftBlogPost({
      title,
      inputMode: "prompt",
      prompt: topic,
      tone,
      targetWords,
      therapy: null,
      videoTranscript: null,
      videoProjectName: null,
    });
    recordUsage(ctx.tenantId, "marketing", MARKETING_MODEL, toMeteredUsage(draft.usage));

    return {
      text: JSON.stringify({
        result:
          "Draft prepared — this has NOT been saved. Share it with the operator and get approval before calling save_blog_post.",
        title,
        content: draft.content,
      }),
    };
  } catch (e) {
    return { text: JSON.stringify({ error: e instanceof Error ? e.message : "Failed to draft the blog post." }) };
  }
}

/** WRITE — persist a blog post as a draft (status "ready", publishState "draft"). Never publishes. */
export function saveBlogPostTool(ctx: ToolContext, input: Record<string, unknown>): ToolResult {
  const title = String(input.title || "").trim();
  const content = String(input.content || "").trim();
  if (!title) return { text: JSON.stringify({ error: "title is required." }) };
  if (!content) return { text: JSON.stringify({ error: "content is required." }) };
  const excerpt = input.excerpt != null ? String(input.excerpt).trim() : "";

  const site = resolveSite(ctx, input.siteId);
  if ("error" in site) return site.error;

  const wordCount = content.split(/\s+/).filter(Boolean).length;

  const post = createSiteBlogPost({
    siteId: site.id,
    title,
    inputMode: "prompt",
    prompt: null,
    tone: null,
    targetWords: wordCount || 700,
    sourceTherapyId: null,
    sourceVideoProjectId: null,
  });

  // createSiteBlogPost always defaults status:"generating" — it's designed
  // for the async-generation flow (see @/lib/blog/generator.ts's
  // runBlogGeneration, which writes content+"ready" once the AI call
  // returns). We already HAVE the content here (drafted via draft_blog_post,
  // or supplied directly by the operator), so flip it to "ready" immediately
  // rather than leaving the post stuck mid-generation forever.
  updateBlogContent(post.id, { content, status: "ready" });
  if (excerpt) updateBlogMeta(site.id, post.id, { excerpt });

  return {
    text: JSON.stringify({
      result: `Saved "${title}" as a draft on ${site.name}. It is NOT published — use publish_blog_post when the operator is ready to go live.`,
      postId: post.id,
      siteId: site.id,
      status: "ready",
      publishState: "draft",
    }),
  };
}

/** WRITE — publish an existing saved draft to the LIVE public site. Approve-gated: pushes live immediately. */
export function publishBlogPostTool(ctx: ToolContext, input: Record<string, unknown>): ToolResult {
  const postId = Number(input.postId);
  if (!postId) return { text: JSON.stringify({ error: "postId is required." }) };

  const site = resolveSite(ctx, input.siteId);
  if ("error" in site) return site.error;

  const post = getSiteBlogPost(site.id, postId);
  if (!post) return { text: JSON.stringify({ error: `No blog post with id ${postId} on ${site.name}.` }) };

  setPublishState(site.id, postId, "published");
  return {
    text: JSON.stringify({
      result: `Published "${post.title}" to the live site (${site.name}).`,
      postId,
      siteId: site.id,
      publishState: "published",
    }),
  };
}

/** READ — draft carousel slides + caption via the real generateCarouselSlides generator. Performs NO persistence. */
export async function draftCarouselTool(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
  const topic = String(input.topic || "").trim();
  if (!topic) return { text: JSON.stringify({ error: "topic is required." }) };
  const tone = input.tone != null ? String(input.tone).trim() || null : null;
  const slideCountArg = Number(input.slideCount);
  const slideCount =
    Number.isFinite(slideCountArg) && slideCountArg > 0
      ? Math.min(10, Math.max(2, Math.round(slideCountArg)))
      : 5;

  try {
    assertUnderCap(ctx.tenantId);
    const draft = await generateCarouselSlides({ topic, slideCount, tone });
    recordUsage(ctx.tenantId, "marketing", MARKETING_MODEL, toMeteredUsage(draft.usage));

    return {
      text: JSON.stringify({
        result: "Carousel drafted — this has NOT been saved or posted. Refine or export it in Content Studio.",
        caption: draft.caption,
        slides: draft.slides,
      }),
    };
  } catch (e) {
    return { text: JSON.stringify({ error: e instanceof Error ? e.message : "Failed to draft the carousel." }) };
  }
}
