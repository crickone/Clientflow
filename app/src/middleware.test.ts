// Run: npm test -- src/middleware.test.ts
//
// A mapped client domain rewrites "/privacy" to "/site/<slug>/privacy". The root
// layout picks the bare public render from the x-pathname request header, so the
// header must carry the REWRITTEN path; with the original one, every signed-out
// visitor on a mapped domain was redirected to /login (2026-09-23 to 2026-10-03).
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

process.env.CMS_SITE_HOSTS = "www.example-client.ie=example";
process.env.SITES_PROXY_SECRET = "a-test-secret-of-some-length";

async function main() {
  const { middleware } = await import("./middleware");

  for (const [path, expected] of [
    ["/", "/site/example"],
    ["/privacy", "/site/example/privacy"],
  ] as const) {
    const res = middleware(new NextRequest(`https://www.example-client.ie${path}`, { headers: { host: "www.example-client.ie" } }));
    assert.ok(res, `${path}: middleware returned a response`);
    assert.equal(res.headers.get("location"), null, `${path}: no redirect`);
    assert.ok(res.headers.get("x-middleware-rewrite")?.endsWith(expected), `${path}: rewritten to ${expected}`);
    assert.equal(res.headers.get("x-middleware-request-x-pathname"), expected, `${path}: x-pathname is the rewritten path`);
  }
  // Meta fetches post images without a session. Redirecting it to /login
  // handed Meta an HTML page: "The image format is not supported" (2026-10-03).
  for (const path of ["/api/social/render/sometoken", "/api/integrations/meta/webhook", "/api/integrations/meta/data-deletion"]) {
    const res = middleware(new NextRequest(`https://app.adonisagent.ie${path}`, { headers: { host: "app.adonisagent.ie" } }));
    assert.equal(res?.headers.get("location") ?? null, null, `${path}: reachable without a session`);
  }
  // A client domain through the Cloudflare Worker: trusted only with the
  // secret, rewritten under the placeholder slug, the domain handed on to the
  // page and the secret never passed further.
  const railway = "https://clientflow-production-ee94.up.railway.app";
  {
    const res = middleware(
      new NextRequest(`${railway}/pricing`, {
        headers: { host: "clientflow-production-ee94.up.railway.app", "x-adonis-site-host": "www.optimalhealthatinspire.ie", "x-adonis-proxy-key": "a-test-secret-of-some-length" },
      }),
    );
    assert.ok(res.headers.get("x-middleware-rewrite")?.endsWith("/site/_host/pricing"), "proxied: rewritten under the placeholder slug");
    assert.equal(res.headers.get("x-middleware-request-x-adonis-site-host"), "www.optimalhealthatinspire.ie", "proxied: the domain reaches the page");
    assert.equal(res.headers.get("x-middleware-request-x-adonis-proxy-key"), null, "proxied: the secret goes no further");
  }
  {
    // Library images inside a page load on the client's domain too (the
    // InBody photo on Inspire 404'd the day it went live).
    const res = middleware(
      new NextRequest(`${railway}/library-media/2`, {
        headers: { host: "clientflow-production-ee94.up.railway.app", "x-adonis-site-host": "www.inspirehealthandfitness.ie", "x-adonis-proxy-key": "a-test-secret-of-some-length" },
      }),
    );
    assert.equal(res.headers.get("x-middleware-rewrite"), null, "library media: not rewritten into the site");
    assert.equal(res.headers.get("location"), null, "library media: no login redirect");
  }
  {
    // A forged header without the secret is stripped and changes nothing.
    const res = middleware(
      new NextRequest(`${railway}/site/x`, {
        headers: { host: "clientflow-production-ee94.up.railway.app", "x-adonis-site-host": "www.victim.ie", "x-adonis-proxy-key": "wrong" },
      }),
    );
    assert.equal(res.headers.get("x-middleware-rewrite"), null, "forged: not rewritten");
    assert.notEqual(res.headers.get("x-middleware-request-x-adonis-site-host"), "www.victim.ie", "forged: the domain does not reach the page");
  }
  console.log("middleware: mapped-domain rewrite and public-route checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
