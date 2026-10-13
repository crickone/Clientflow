import crypto from "node:crypto";

/**
 * Stripe's API takes form-encoded bodies with bracketed keys:
 * { line_items: [{ price_data: { currency: "eur" } }] } becomes
 * line_items[0][price_data][currency]=eur. Null and undefined are left out.
 */
export function formEncode(params: Record<string, unknown>): string {
  const out: string[] = [];
  const walk = (key: string, value: unknown) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(`${key}[${i}]`, v));
    } else if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(`${key}[${k}]`, v);
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return out.join("&");
}

/**
 * Check a Stripe-Signature header ("t=<unix>,v1=<hex>,...") against the raw
 * request body: HMAC-SHA256 of "<t>.<body>" with the endpoint's signing
 * secret, and the timestamp within `toleranceSec` of now (replay guard).
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string | null | undefined,
  nowSec = Math.floor(Date.now() / 1000),
  toleranceSec = 300,
): boolean {
  if (!header || !secret) return false;
  let t = 0;
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2).map((s) => s?.trim());
    if (k === "t") t = Number(v);
    else if (k === "v1" && v) sigs.push(v);
  }
  if (!Number.isFinite(t) || t <= 0 || sigs.length === 0) return false;
  if (Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex");
  const exp = Buffer.from(expected, "hex");
  return sigs.some((s) => {
    if (!/^[0-9a-f]+$/i.test(s)) return false;
    const got = Buffer.from(s, "hex");
    return got.length === exp.length && crypto.timingSafeEqual(got, exp);
  });
}
