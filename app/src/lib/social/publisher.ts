import "server-only";

import { readKeyForTenant, setKey } from "@/lib/settings";

/**
 * Posting to social, behind one interface.
 *
 * The scheduler (./schedule.ts) never talks to Meta; it asks for the tenant's
 * publisher and hands it a caption and image URLs. Today that publisher is
 * null for everyone -- Meta App Review for the posting permissions is in
 * progress -- so due posts wait, honestly labelled, and nothing is claimed.
 * The moment a page connection is stored under META_CONNECTION_KEY the same
 * scheduler starts posting through MetaGraphPublisher below, which is written
 * against the Graph API as documented so the connection flow is the only
 * thing left to build when the review lands.
 */

export type SocialChannel = "facebook" | "instagram";

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

/** What the Facebook connection flow will store, once App Review allows it. */
export interface MetaConnection {
  pageId: string;
  pageName?: string | null;
  /** A long-lived Page access token with pages_manage_posts (+ instagram_content_publish). */
  pageAccessToken: string;
  /** The Instagram professional account linked to the page, when there is one. */
  igUserId?: string | null;
}

export function getMetaConnectionForTenant(tenantId: number): MetaConnection | null {
  const raw = readKeyForTenant<unknown>(tenantId, META_CONNECTION_KEY, null);
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.pageId !== "string" || !c.pageId || typeof c.pageAccessToken !== "string" || !c.pageAccessToken) return null;
  return {
    pageId: c.pageId,
    pageName: typeof c.pageName === "string" ? c.pageName : null,
    pageAccessToken: c.pageAccessToken,
    igUserId: typeof c.igUserId === "string" && c.igUserId ? c.igUserId : null,
  };
}

/** Store (or clear, with null) the page connection for the ambient tenant. */
export function setMetaConnection(connection: MetaConnection | null): void {
  setKey(META_CONNECTION_KEY, connection);
}

export function isMetaConnected(tenantId: number): boolean {
  return getMetaConnectionForTenant(tenantId) !== null;
}

/** The publisher for a tenant, or null while there is nothing to publish through. */
export function getSocialPublisher(tenantId: number): SocialPublisher | null {
  const connection = getMetaConnectionForTenant(tenantId);
  if (!connection) return null;
  return new MetaGraphPublisher(connection);
}

// ─── Meta Graph API ──────────────────────────────────────────────────────────

const GRAPH = "https://graph.facebook.com/v21.0";

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
