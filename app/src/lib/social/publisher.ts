import "server-only";

import { readKeyForTenant, setKey } from "@/lib/settings";
import { getPostingPage } from "@/lib/facebook/pages";
import { GRAPH_BASE } from "@/lib/facebook/graph";
import { isGoogleProfileConnected, postToGoogle } from "@/lib/google/business";

/**
 * Posting to social, behind one interface.
 *
 * The scheduler (./schedule.ts) never talks to Meta; it asks for the tenant's
 * publisher and hands it a caption and image URLs. The publisher exists once
 * the tenant has connected a Facebook Page (Settings > Integrations >
 * Facebook, stored control-plane in facebook_pages with its Page token and
 * linked Instagram account); until then it is null and due posts wait,
 * honestly labelled. The tenant setting under META_CONNECTION_KEY only records
 * WHICH connected Page to post from; no token lives in tenant settings.
 */

export type SocialChannel = "facebook" | "instagram" | "google";

export interface PublishInput {
  channels: SocialChannel[];
  caption: string;
  /** Publicly fetchable PNG URLs, in slide order. Meta downloads these itself. */
  imageUrls: string[];
}

export type PublishResult =
  | { ok: true; refs: Partial<Record<SocialChannel, string>>; warning?: string }
  | { ok: false; error: string };

export interface SocialPublisher {
  publish(input: PublishInput): Promise<PublishResult>;
}

export const META_CONNECTION_KEY = "meta_connection";

/** The Page a tenant posts through, resolved with its token (server-only). */
export interface MetaConnection {
  pageId: string;
  pageName?: string | null;
  /** A long-lived Page access token with pages_manage_posts (+ instagram_content_publish). */
  pageAccessToken: string;
  /** The Instagram professional account linked to the page, when there is one. */
  igUserId?: string | null;
}

/** The tenant's chosen posting Page id, or null when none was picked. */
export function getPreferredPostingPageId(tenantId: number): string | null {
  const raw = readKeyForTenant<unknown>(tenantId, META_CONNECTION_KEY, null);
  if (!raw || typeof raw !== "object") return null;
  const pageId = (raw as Record<string, unknown>).pageId;
  return typeof pageId === "string" && pageId ? pageId : null;
}

export function getMetaConnectionForTenant(tenantId: number): MetaConnection | null {
  return getPostingPage(tenantId, getPreferredPostingPageId(tenantId));
}

/** Pick which connected Page the ambient tenant posts from (null = the default). */
export function setPostingPage(pageId: string | null): void {
  setKey(META_CONNECTION_KEY, pageId ? { pageId } : null);
}

export function isMetaConnected(tenantId: number): boolean {
  return getMetaConnectionForTenant(tenantId) !== null;
}

export const META_NOT_CONNECTED = "Waiting for a Facebook Page to be connected (Settings > Integrations > Facebook).";
export const GOOGLE_NOT_CONNECTED = "Waiting for a Google Business Profile to be connected (Settings > Integrations > Google).";

/**
 * Why a post on these channels cannot go out yet, or null when every channel
 * it needs is connected. A post missing a connection WAITS (it is not failed),
 * and goes out once the connection exists.
 */
export function missingConnection(tenantId: number, channels: SocialChannel[]): string | null {
  if ((channels.includes("facebook") || channels.includes("instagram")) && !getMetaConnectionForTenant(tenantId)) return META_NOT_CONNECTED;
  if (channels.includes("google") && !isGoogleProfileConnected(tenantId)) return GOOGLE_NOT_CONNECTED;
  return null;
}

/**
 * The publisher for a tenant, or null while there is nothing to publish
 * through. Facebook and Instagram go through the Meta Graph API; Google
 * through the Business Profile. One post can go to all three.
 */
export function getSocialPublisher(tenantId: number): SocialPublisher | null {
  const meta = getMetaConnectionForTenant(tenantId);
  const google = isGoogleProfileConnected(tenantId);
  if (!meta && !google) return null;
  return new CompositePublisher(meta ? new MetaGraphPublisher(meta) : null, google ? new GoogleBusinessPublisher(tenantId) : null);
}

class CompositePublisher implements SocialPublisher {
  constructor(
    private readonly meta: SocialPublisher | null,
    private readonly google: SocialPublisher | null,
  ) {}

  async publish(input: PublishInput): Promise<PublishResult> {
    const metaChannels = input.channels.filter((c) => c !== "google");
    const parts: PublishResult[] = [];
    if (metaChannels.length) {
      parts.push(this.meta ? await this.meta.publish({ ...input, channels: metaChannels }) : { ok: false, error: META_NOT_CONNECTED });
    }
    if (input.channels.includes("google")) {
      parts.push(this.google ? await this.google.publish({ ...input, channels: ["google"] }) : { ok: false, error: GOOGLE_NOT_CONNECTED });
    }
    const refs: Partial<Record<SocialChannel, string>> = {};
    const problems: string[] = [];
    for (const p of parts) {
      if (p.ok) {
        Object.assign(refs, p.refs);
        if (p.warning) problems.push(p.warning);
      } else problems.push(p.error);
    }
    if (Object.keys(refs).length === 0) return { ok: false, error: problems.join(" ") || "No channel selected." };
    return problems.length ? { ok: true, refs, warning: problems.join(" ") } : { ok: true, refs };
  }
}

/** A Google post: the caption and the first slide as its photo. */
class GoogleBusinessPublisher implements SocialPublisher {
  constructor(private readonly tenantId: number) {}

  async publish(input: PublishInput): Promise<PublishResult> {
    try {
      const ref = await postToGoogle(this.tenantId, { caption: input.caption, imageUrl: input.imageUrls[0] ?? null });
      return { ok: true, refs: { google: ref } };
    } catch (err) {
      return { ok: false, error: `Google: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}

// ─── Meta Graph API ──────────────────────────────────────────────────────────

const GRAPH = GRAPH_BASE;

async function graph<T = Record<string, unknown>>(
  path: string,
  token: string,
  params: Record<string, string>,
): Promise<T> {
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${GRAPH}/${path}`, { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = json.error as { message?: string } | undefined;
    throw new Error(err?.message || `Graph API ${path} failed (${res.status}).`);
  }
  return json as T;
}

/**
 * Posts a set of images to a Facebook Page and/or the Instagram account
 * linked to it. One image is a photo post; several are a multi-photo post
 * on Facebook and a carousel on Instagram.
 */
export class MetaGraphPublisher implements SocialPublisher {
  constructor(private readonly connection: MetaConnection) {}

  async publish(input: PublishInput): Promise<PublishResult> {
    if (input.imageUrls.length === 0) return { ok: false, error: "Nothing to post: no images." };
    const refs: Partial<Record<SocialChannel, string>> = {};
    const errors: string[] = [];

    if (input.channels.includes("facebook")) {
      try {
        refs.facebook = await this.publishFacebook(input);
      } catch (err) {
        errors.push(`Facebook: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (input.channels.includes("instagram")) {
      if (!this.connection.igUserId) {
        errors.push("Instagram: no Instagram account is linked to the connected page.");
      } else {
        try {
          refs.instagram = await this.publishInstagram(input, this.connection.igUserId);
        } catch (err) {
          errors.push(`Instagram: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    if (Object.keys(refs).length === 0) return { ok: false, error: errors.join(" ") || "No channel selected." };
    // Partial success is still a post that went out; the failure is kept on
    // the row by the caller so the operator can post the rest by hand.
    return errors.length > 0 ? { ok: true, refs, warning: errors.join(" ") } : { ok: true, refs };
  }

  private async publishFacebook(input: PublishInput): Promise<string> {
    const { pageId, pageAccessToken: token } = this.connection;
    if (input.imageUrls.length === 1) {
      const r = await graph<{ post_id?: string; id: string }>(`${pageId}/photos`, token, {
        url: input.imageUrls[0],
        message: input.caption,
      });
      return r.post_id ?? r.id;
    }
    const mediaIds: string[] = [];
    for (const url of input.imageUrls) {
      const r = await graph<{ id: string }>(`${pageId}/photos`, token, { url, published: "false" });
      mediaIds.push(r.id);
    }
    const post = await graph<{ id: string }>(`${pageId}/feed`, token, {
      message: input.caption,
      attached_media: JSON.stringify(mediaIds.map((id) => ({ media_fbid: id }))),
    });
    return post.id;
  }

  private async publishInstagram(input: PublishInput, igUserId: string): Promise<string> {
    const token = this.connection.pageAccessToken;
    let creationId: string;
    if (input.imageUrls.length === 1) {
      const r = await graph<{ id: string }>(`${igUserId}/media`, token, {
        image_url: input.imageUrls[0],
        caption: input.caption,
      });
      creationId = r.id;
    } else {
      const children: string[] = [];
      for (const url of input.imageUrls.slice(0, 10)) {
        const r = await graph<{ id: string }>(`${igUserId}/media`, token, { image_url: url, is_carousel_item: "true" });
        children.push(r.id);
      }
      const r = await graph<{ id: string }>(`${igUserId}/media`, token, {
        media_type: "CAROUSEL",
        children: children.join(","),
        caption: input.caption,
      });
      creationId = r.id;
    }
    const published = await graph<{ id: string }>(`${igUserId}/media_publish`, token, { creation_id: creationId });
    return published.id;
  }
}
