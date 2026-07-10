import "server-only";

import { GRAPH_BASE } from "./graph";
import { getSocialConnection, markSocialInvalid } from "./config";

export type SocialTarget = "facebook" | "instagram";

export interface TargetResult {
  ok: boolean;
  postId?: string;
  error?: string;
}

export interface PublishResult {
  facebook?: TargetResult;
  instagram?: TargetResult;
}

/** Minimal shape of the Graph API JSON responses we read. */
interface MetaResponse {
  id?: string;
  post_id?: string;
  error?: { message?: string; code?: number; type?: string };
}

async function postForm(
  url: string,
  params: Record<string, string>,
): Promise<{ ok: boolean; data: MetaResponse }> {
  let data: MetaResponse = {};
  try {
    const res = await fetch(url, {
      method: "POST",
      body: new URLSearchParams(params),
    });
    data = (await res.json().catch(() => ({}))) as MetaResponse;
    return { ok: res.ok, data };
  } catch (err) {
    return {
      ok: false,
      data: { error: { message: err instanceof Error ? err.message : "Network error" } },
    };
  }
}

/** Map a Meta error response to a TargetResult; flag token issues for reconnect. */
function fail(data: MetaResponse): TargetResult {
  const code = data.error?.code;
  // 190 = invalid/expired access token → prompt a reconnect in the UI.
  if (code === 190) markSocialInvalid();
  return { ok: false, error: data.error?.message ?? "Unknown Meta API error" };
}

/**
 * Publish an image + caption to the connected FB Page and/or its IG account.
 * A failing target never aborts the other — each result is independent. The
 * imageUrl MUST be a public https URL (Meta fetches it server-side).
 */
export async function publishImagePost(input: {
  targets: SocialTarget[];
  imageUrl: string;
  caption: string;
}): Promise<PublishResult> {
  const { targets, imageUrl, caption } = input;
  const result: PublishResult = {};
  const conn = getSocialConnection();

  if (!conn || conn.status !== "connected") {
    const error = "Social account not connected.";
    if (targets.includes("facebook")) result.facebook = { ok: false, error };
    if (targets.includes("instagram")) result.instagram = { ok: false, error };
    return result;
  }
  const token = conn.pageAccessToken;

  if (targets.includes("facebook")) {
    result.facebook = await publishFacebook(conn.pageId, token, imageUrl, caption);
  }
  if (targets.includes("instagram")) {
    result.instagram = conn.igUserId
      ? await publishInstagram(conn.igUserId, token, imageUrl, caption)
      : { ok: false, error: "No Instagram account is linked to this Page." };
  }
  return result;
}

async function publishFacebook(
  pageId: string,
  token: string,
  imageUrl: string,
  caption: string,
): Promise<TargetResult> {
  const { ok, data } = await postForm(`${GRAPH_BASE}/${pageId}/photos`, {
    url: imageUrl,
    caption,
    access_token: token,
  });
  if (!ok) return fail(data);
  return { ok: true, postId: data.post_id ?? data.id };
}

async function publishInstagram(
  igUserId: string,
  token: string,
  imageUrl: string,
  caption: string,
): Promise<TargetResult> {
  // Step 1 — create a media container.
  const create = await postForm(`${GRAPH_BASE}/${igUserId}/media`, {
    image_url: imageUrl,
    caption,
    access_token: token,
  });
  if (!create.ok) return fail(create.data);
  const creationId = create.data.id;
  if (!creationId) {
    return { ok: false, error: "Instagram did not return a media container id." };
  }
  // Step 2 — publish the container.
  const pub = await postForm(`${GRAPH_BASE}/${igUserId}/media_publish`, {
    creation_id: creationId,
    access_token: token,
  });
  if (!pub.ok) return fail(pub.data);
  return { ok: true, postId: pub.data.id };
}
