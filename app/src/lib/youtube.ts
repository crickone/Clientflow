/**
 * YouTube helpers for the exercise library: parse any YouTube URL to a video id,
 * build embed/thumbnail URLs (no API key needed), and search for a "how to"
 * video via the YouTube Data API (needs YOUTUBE_API_KEY).
 */

/** Extract the 11-char video id from any common YouTube URL/id form, else null. */
export function parseYouTubeId(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  // Bare id
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = u.pathname.slice(1, 12);
    return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    const v = u.searchParams.get("v");
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
    // /embed/ID, /shorts/ID, /v/ID
    const m = u.pathname.match(/\/(?:embed|shorts|v)\/([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
  }
  return null;
}

export function isYouTubeUrl(input: string | null | undefined): boolean {
  return parseYouTubeId(input) !== null;
}

/** Privacy-friendly embed URL for an id (youtube-nocookie). */
export function youtubeEmbedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}`;
}

/** Thumbnail URL for an id. hq = 480×360 default. */
export function youtubeThumbnail(id: string, quality: "hq" | "mq" | "max" = "hq"): string {
  const file = quality === "max" ? "maxresdefault" : quality === "mq" ? "mqdefault" : "hqdefault";
  return `https://i.ytimg.com/vi/${id}/${file}.jpg`;
}

export type YouTubeHit = { id: string; url: string; title: string; channel: string };
export type SearchStatus = "ok" | "empty" | "quota" | "rate" | "error";
export type SearchResult = { status: SearchStatus; hit?: YouTubeHit };

/** Low-level search that surfaces WHY it failed (quota vs rate limit vs error). */
export async function searchExerciseVideoDetailed(exerciseName: string): Promise<SearchResult> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return { status: "error" };
  const q = `how to ${exerciseName} exercise proper form`;
  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    maxResults: "1",
    videoEmbeddable: "true",
    safeSearch: "strict",
    q,
    key,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      let reason = "";
      try {
        const body = (await res.json()) as { error?: { errors?: Array<{ reason?: string }> } };
        reason = body.error?.errors?.[0]?.reason ?? "";
      } catch {
        /* ignore */
      }
      if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") return { status: "quota" };
      if (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") return { status: "rate" };
      return { status: "error" };
    }
    const data = (await res.json()) as {
      items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string } }>;
    };
    const item = data.items?.[0];
    const id = item?.id?.videoId;
    if (!id) return { status: "empty" };
    return {
      status: "ok",
      hit: {
        id,
        url: `https://www.youtube.com/watch?v=${id}`,
        title: item?.snippet?.title ?? exerciseName,
        channel: item?.snippet?.channelTitle ?? "",
      },
    };
  } catch {
    return { status: "error" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Search YouTube for the best "how to" demo of an exercise. Returns the top
 * embeddable result, or null (no key configured / no result / API error).
 */
export async function searchExerciseVideo(exerciseName: string): Promise<YouTubeHit | null> {
  const res = await searchExerciseVideoDetailed(exerciseName);
  return res.hit ?? null;
}
