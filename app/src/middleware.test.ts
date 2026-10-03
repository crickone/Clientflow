// Run: npm test -- src/middleware.test.ts
//
// A mapped client domain rewrites "/privacy" to "/site/<slug>/privacy". The root
// layout picks the bare public render from the x-pathname request header, so the
// header must carry the REWRITTEN path; with the original one, every signed-out
// visitor on a mapped domain was redirected to /login (2026-09-23 to 2026-10-03).
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

process.env.CMS_SITE_HOSTS = "www.example-client.ie=example";

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
  console.log("middleware: mapped-domain rewrite and public-route checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
