// Run: npm test -- "src/app/api/inbox/media/[file]/route.test.ts"
//
// The inbox media route serves a stored photo/file only to signed-in staff,
// and only from the CURRENT business's private folder: a path-traversal name
// is refused, and another business's file is simply not found. The session
// guard and the current-tenant lookup are stubbed (no Next request context in
// this runner); the file serving is real.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { createRequire } from "node:module";

const SLUG_A = "inbox-media-route-a";
const SLUG_B = "inbox-media-route-b";
let signedIn = true;

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "@/lib/api/guard") {
    return { guard: async () => (signedIn ? null : new Response(JSON.stringify({ ok: false }), { status: 401 })) };
  }
  if (request === "@/lib/db/tenant") {
    return {
      getCurrentTenant: () => ({ id: 1, slug: SLUG_A }),
      getTenantById: () => undefined,
      getTenantDbById: () => {
        throw new Error("not used by the route");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

(async () => {
  const { GET } = requireLocal("./route") as typeof import("./route");
  const root = path.join(process.cwd(), "data", "tenants");
  const dirA = path.join(root, SLUG_A, "inbox-media");
  const dirB = path.join(root, SLUG_B, "inbox-media");
  fs.mkdirSync(dirA, { recursive: true });
  fs.mkdirSync(dirB, { recursive: true });
  const fileA = `${crypto.randomBytes(16).toString("hex")}.jpg`;
  const fileB = `${crypto.randomBytes(16).toString("hex")}.jpg`;
  const pdfA = `${crypto.randomBytes(16).toString("hex")}.pdf`;
  const binA = `${crypto.randomBytes(16).toString("hex")}.bin`;
  fs.writeFileSync(path.join(dirA, fileA), Buffer.from("jpeg-bytes-of-a"));
  fs.writeFileSync(path.join(dirB, fileB), Buffer.from("jpeg-bytes-of-b"));
  fs.writeFileSync(path.join(dirA, pdfA), Buffer.from("%PDF-1.4"));
  fs.writeFileSync(path.join(dirA, binA), Buffer.from("<html><script>alert(1)</script></html>"));
  fs.writeFileSync(path.join(root, SLUG_A, "secret.jpg"), Buffer.from("not media"));

  const get = (file: string, headers: Record<string, string> = {}) =>
    GET(new Request(`http://localhost/api/inbox/media/${encodeURIComponent(file)}`, { headers }) as never, { params: Promise.resolve({ file }) });

  try {
    const ok = await get(fileA);
    check("own file: 200", ok.status === 200);
    check("own file: image/jpeg", ok.headers.get("content-type") === "image/jpeg");
    check("own file: private cache", (ok.headers.get("cache-control") ?? "").startsWith("private"));
    check("own file: nosniff + sandbox CSP", ok.headers.get("x-content-type-options") === "nosniff" && (ok.headers.get("content-security-policy") ?? "").includes("sandbox"));
    check("own file: the bytes", (await ok.text()) === "jpeg-bytes-of-a");

    check("another business's file: 404", (await get(fileB)).status === 404);
    check("traversal to another business: refused", (await get(`../../${SLUG_B}/inbox-media/${fileB}`)).status === 400);
    check("traversal out of the folder: refused", (await get("../secret.jpg")).status === 400);
    check("encoded traversal: refused", (await get("..%2Fsecret.jpg")).status === 400);
    check("made-up name: refused", (await get("photo.jpg")).status === 400);
    check("unknown well-formed name: 404", (await get(`${"0".repeat(32)}.jpg`)).status === 404);

    const pdf = await get(pdfA);
    check("pdf downloads as an attachment", pdf.status === 200 && pdf.headers.get("content-type") === "application/pdf" && pdf.headers.get("content-disposition") === "attachment");
    const bin = await get(binA);
    check("unknown type: octet-stream attachment, never rendered", bin.headers.get("content-type") === "application/octet-stream" && bin.headers.get("content-disposition") === "attachment");

    const part = await get(fileA, { range: "bytes=0-3" });
    check("range request: 206 with the first bytes", part.status === 206 && part.headers.get("content-range") === "bytes 0-3/15" && (await part.text()) === "jpeg");

    signedIn = false;
    check("signed out: 401", (await get(fileA)).status === 401);
  } finally {
    fs.rmSync(path.join(root, SLUG_A), { recursive: true, force: true });
    fs.rmSync(path.join(root, SLUG_B), { recursive: true, force: true });
  }
  console.log(`\ninbox media route: ${passed} checks passed.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
