// Run: npm test -- src/lib/cms/customHostnames.test.ts
//
// Client domains: the trusted-proxy check, Cloudflare's hostname record as the
// Domains page reports it, and the bare-domain test.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "server-only") return {};
  if (request.endsWith("/lib/db/control") || request === "@/lib/db/control") return { controlDb: {} };
  if (request === "@/lib/db") return { db: {}, schema: {} };
  return realLoad.call(this, request, ...rest);
};
const req = createRequire(import.meta.url);
const { cleanHost, trustedProxyHost } = req("./proxyHost") as typeof import("./proxyHost");
const { summariseHostname, cnameTarget, hostnameConfig } = req("./customHostnames") as typeof import("./customHostnames");

const SECRET = "a-test-secret-of-some-length";
const hdr = (h: Record<string, string>) => (n: string) => h[n] ?? null;

// The proxy is trusted only with the right secret, and never without one.
assert.equal(trustedProxyHost(hdr({ "x-adonis-proxy-key": SECRET, "x-adonis-site-host": "WWW.Client.ie:443" }), SECRET), "www.client.ie");
assert.equal(trustedProxyHost(hdr({ "x-adonis-proxy-key": "nope", "x-adonis-site-host": "www.client.ie" }), SECRET), null);
assert.equal(trustedProxyHost(hdr({ "x-adonis-proxy-key": SECRET, "x-adonis-site-host": "www.client.ie" }), undefined), null);
assert.equal(trustedProxyHost(hdr({ "x-adonis-proxy-key": "short", "x-adonis-site-host": "www.client.ie" }), "short"), null);
assert.equal(cleanHost("evil host/../"), null);

// Cloudflare's record, as the Domains page states it.
assert.equal(summariseHostname(null).state, "missing");
assert.equal(summariseHostname({ id: "a", status: "active", ssl: { status: "active" } }).state, "active");
assert.equal(summariseHostname({ id: "a", status: "pending", ssl: { status: "pending_validation" } }).state, "pending");
assert.equal(summariseHostname({ id: "a", status: "blocked", ssl: { status: "pending_validation" } }).state, "failed");
assert.ok(summariseHostname({ id: "a", status: "pending", verification_errors: ["custom hostname does not CNAME to this zone."] }).detail.includes("does not CNAME"));

// Config.
assert.equal(cnameTarget({}), "sites.adonisagent.ie");
assert.equal(hostnameConfig({ CLOUDFLARE_API_TOKEN: "t" }), null);
assert.deepEqual(hostnameConfig({ CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ZONE_ID: "z" }), { token: "t", zoneId: "z" });

// Bare domains, which most registrars cannot CNAME.
const { isApexHost } = req("./domains") as typeof import("./domains");
assert.equal(isApexHost("optimalhealthatinspire.ie"), true);
assert.equal(isApexHost("www.optimalhealthatinspire.ie"), false);
assert.equal(isApexHost("example.co.uk"), true);
assert.equal(isApexHost("www.example.co.uk"), false);

console.log("customHostnames: 17 checks passed.");
