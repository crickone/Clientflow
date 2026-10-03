import crypto from "node:crypto";

/**
 * Meta's signed_request (data deletion and deauthorize callbacks):
 * "<base64url HMAC-SHA256 signature>.<base64url JSON payload>", signed with the
 * app secret. Returns the payload only when the signature checks out; null for
 * anything malformed, unsigned or signed with another secret. Never throws.
 */
export interface SignedRequestPayload {
  user_id?: string;
  algorithm?: string;
  issued_at?: number;
  [key: string]: unknown;
}

export function parseSignedRequest(signedRequest: string | null | undefined, appSecret: string | undefined): SignedRequestPayload | null {
  if (!signedRequest || !appSecret) return null;
  const [sig, body] = signedRequest.split(".", 2);
  if (!sig || !body) return null;
  try {
    const expected = crypto.createHmac("sha256", appSecret).update(body).digest();
    const given = Buffer.from(sig, "base64url");
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SignedRequestPayload;
    if (typeof payload !== "object" || payload === null) return null;
    if (payload.algorithm && String(payload.algorithm).toUpperCase() !== "HMAC-SHA256") return null;
    return payload;
  } catch {
    return null;
  }
}
