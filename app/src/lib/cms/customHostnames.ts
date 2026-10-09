/**
 * Client domains on Cloudflare for SaaS ("custom hostnames").
 *
 * Each domain a client connects in the CMS is registered on the platform's
 * Cloudflare zone, which issues and renews its HTTPS certificate once the
 * client's DNS points at SITES_CNAME_TARGET, and sends its traffic through
 * the Worker to the app (see ./proxyHost). Nothing per client is added on
 * Railway and nothing is redeployed.
 *
 * Raw fetch against the v4 API, no SDK. Every call returns a typed result and
 * never throws: a Cloudflare outage or a missing token must reach the operator
 * as a readable reason on the Domains page, not as a crashed action. The
 * parsing is pure and exported for the tests.
 */

const API = "https://api.cloudflare.com/client/v4";

export interface HostnameConfig {
  token: string;
  zoneId: string;
}

export function hostnameConfig(env: Record<string, string | undefined> = process.env): HostnameConfig | null {
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  const zoneId = env.CLOUDFLARE_ZONE_ID?.trim();
  return token && zoneId ? { token, zoneId } : null;
}

/** What a client points their domain at. */
export function cnameTarget(env: Record<string, string | undefined> = process.env): string {
  return (env.SITES_CNAME_TARGET?.trim() || "sites.adonisagent.ie").toLowerCase();
}

export type HostnameState = "active" | "pending" | "failed" | "missing";

export interface HostnameStatus {
  state: HostnameState;
  id: string | null;
  /** One sentence for the operator. */
  detail: string;
}

/**
 * Cloudflare's custom-hostname record, reduced to what the Domains page says.
 * A hostname is only usable when BOTH the hostname and its certificate are
 * active; either one pending means "waiting for DNS".
 */
export function summariseHostname(raw: unknown): HostnameStatus {
  const r = (raw && typeof raw === "object" ? raw : null) as {
    id?: string;
    status?: string;
    ssl?: { status?: string; validation_errors?: { message?: string }[] };
    verification_errors?: string[];
  } | null;
  if (!r?.id) return { state: "missing", id: null, detail: "Not registered with Cloudflare yet." };
  const host = r.status ?? "";
  const ssl = r.ssl?.status ?? "";
  if (host === "active" && ssl === "active") {
    return { state: "active", id: r.id, detail: "Live: HTTPS certificate issued." };
  }
  const errors = [...(r.verification_errors ?? []), ...(r.ssl?.validation_errors ?? []).map((e) => e.message ?? "")].filter(Boolean);
  if (/blocked|moved|deleted/.test(host) || /expired|deleted|deactivated/.test(ssl)) {
    return { state: "failed", id: r.id, detail: errors[0] ?? `Cloudflare reports ${host || ssl}.` };
  }
  return {
    state: "pending",
    id: r.id,
    detail: errors.length
      ? `Waiting for DNS: ${errors[0]}`
      : "Waiting for the domain's DNS to point here. The certificate is issued automatically once it does.",
  };
}

async function call(cfg: HostnameConfig, path: string, init: RequestInit = {}): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  try {
    const res = await fetch(`${API}/zones/${cfg.zoneId}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as { success?: boolean; result?: unknown; errors?: { message?: string }[] } | null;
    if (!res.ok || !body?.success) {
      return { ok: false, error: body?.errors?.[0]?.message ?? `Cloudflare returned HTTP ${res.status}.` };
    }
    return { ok: true, result: body.result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? `Couldn't reach Cloudflare: ${err.message}` : "Couldn't reach Cloudflare." };
  }
}

/** The current record for a hostname. */
export async function getCustomHostname(host: string, cfg = hostnameConfig()): Promise<HostnameStatus & { error?: string }> {
  if (!cfg) return { state: "missing", id: null, detail: "Client domains are not set up on this platform yet (Cloudflare is not configured)." };
  const res = await call(cfg, `/custom_hostnames?hostname=${encodeURIComponent(host)}`);
  if (!res.ok) return { state: "missing", id: null, detail: res.error ?? "Couldn't check Cloudflare.", error: res.error };
  const list = Array.isArray(res.result) ? res.result : [];
  return summariseHostname(list.find((h) => (h as { hostname?: string })?.hostname === host) ?? null);
}

/**
 * Register a hostname, or return the existing record. HTTP validation: the
 * certificate is issued as soon as the domain's CNAME reaches Cloudflare, so
 * the client adds one record and nothing else.
 */
export async function ensureCustomHostname(host: string, cfg = hostnameConfig()): Promise<HostnameStatus & { error?: string }> {
  if (!cfg) return { state: "missing", id: null, detail: "Client domains are not set up on this platform yet (Cloudflare is not configured)." };
  const existing = await getCustomHostname(host, cfg);
  if (existing.id || existing.error) return existing;
  const res = await call(cfg, "/custom_hostnames", {
    method: "POST",
    body: JSON.stringify({ hostname: host, ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } } }),
  });
  if (!res.ok) return { state: "missing", id: null, detail: res.error ?? "Cloudflare refused the domain.", error: res.error };
  return summariseHostname(res.result);
}

/** Remove a hostname (the domain was removed from its site). Missing is success. */
export async function deleteCustomHostname(host: string, cfg = hostnameConfig()): Promise<{ ok: boolean; error?: string }> {
  if (!cfg) return { ok: true };
  const existing = await getCustomHostname(host, cfg);
  if (existing.error) return { ok: false, error: existing.error };
  if (!existing.id) return { ok: true };
  const res = await call(cfg, `/custom_hostnames/${existing.id}`, { method: "DELETE" });
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}
