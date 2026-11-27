// Run: npm test -- "src/app/api/messages/attachments/public/[token]/route.test.ts"
//
// The public file link Meta fetches for an Instagram send: a good link serves
// exactly that file from that business's inbox-media folder, with the right
// type, nosniff, inline for media and a download for documents. A bad,
// tampered or expired link, a business that does not exist and a file that
// has gone are all a 404. The tenant lookup is stubbed (no control DB in this
// runner); the token and the file serving are real.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { createRequire } from "node:module";

const SLUG_A = "public-attachment-route-a";
const SLUG_B = "public-attachment-route-b";
const TENANTS: Record<number, { id: number; slug: string }> = { 11: { id: 11, slug: SLUG_A }, 12: { id: 12, slug: SLUG_B } };

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "@/lib/db/tenant") {
    return {
      getTenantById: (id: number) => TENANTS[id],
      getCurrentTenant: () => {
        throw new Error("the public route must not use the current tenant");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);
const originalSocial = process.env.SOCIAL_TOKEN_SECRET;
const originalEmail = process.env.EMAIL_TOKEN_SECRET;
delete process.env.SOCIAL_TOKEN_SECRET;
process.env.EMAIL_TOKEN_SECRET = "test-public-attachment-route-secret";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

(async () => {
  const { GET } = requireLocal("./route") as typeof import("./route");
  const { signPublicFile } = requireLocal("../../../../../../lib/attachments/publicLink") as typeof import("@/lib/attachments/publicLink");
  const root = path.join(process.cwd(), "data", "tenants");
  const dirA = path.join(root, SLUG_A, "inbox-media");
  const dirB = path.join(root, SLUG_B, "inbox-media");
  fs.mkdirSync(dirA, { recursive: true });
  fs.mkdirSync(dirB, { recursive: true });

  const get = (token: string) => GET(new Request(`http://localhost/api/messages/attachments/public/${token}`), { params: Promise.resolve({ token }) });
  const hex = () => crypto.randomBytes(16).toString("hex");

  try {
    const jpg = `${hex()}.jpg`;
    const jpgBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    fs.writeFileSync(path.join(dirA, jpg), jpgBytes);
    const pdf = `${hex()}.pdf`;
    const pdfBytes = Buffer.from("%PDF-1.4\n%%EOF\n");
    fs.writeFileSync(path.join(dirA, pdf), pdfBytes);

    // 1. A good link: the file, typed, inline for a photo.
    const r1 = await get(encodeURIComponent(signPublicFile({ tenantId: 11, file: jpg })!));
    check("photo: 200", r1.status === 200);
    check("photo: bytes", Buffer.from(await r1.arrayBuffer()).equals(jpgBytes));
    check("photo: image/jpeg", r1.headers.get("content-type") === "image/jpeg");
    check("photo: inline", r1.headers.get("content-disposition") === "inline");
    check("photo: nosniff", r1.headers.get("x-content-type-options") === "nosniff");
    check("photo: sandbox csp", /sandbox/.test(r1.headers.get("content-security-policy") ?? ""));
    check("photo: not cached", r1.headers.get("cache-control") === "private, no-store");

    // 2. A document downloads.
    const r2 = await get(signPublicFile({ tenantId: 11, file: pdf })!);
    check("pdf: 200", r2.status === 200);
    check("pdf: application/pdf", r2.headers.get("content-type") === "application/pdf");
    check("pdf: attachment", r2.headers.get("content-disposition") === "attachment");
    check("pdf: bytes", Buffer.from(await r2.arrayBuffer()).equals(pdfBytes));

    // 3. Bad links are a 404.
    const good = signPublicFile({ tenantId: 11, file: jpg })!;
    const [body, sig] = good.split(".");
    for (const [name, token] of [
      ["junk", "not-a-token"],
      ["tampered signature", `${body}.${sig.slice(0, -2)}xx`],
      ["bad percent encoding", "%E0%A4%A"],
      ["expired", signPublicFile({ tenantId: 11, file: jpg }, -1_000)!],
    ] as const) {
      const r = await get(token);
      check(`${name}: 404`, r.status === 404);
      check(`${name}: nosniff`, r.headers.get("x-content-type-options") === "nosniff");
    }

    // 4. Only that business's folder: the same name under another business is not found there.
    check("other business: 404", (await get(signPublicFile({ tenantId: 12, file: jpg })!)).status === 404);
    check("unknown business: 404", (await get(signPublicFile({ tenantId: 99, file: jpg })!)).status === 404);

    // 5. A file that has gone.
    const gone = `${hex()}.png`;
    check("missing file: 404", (await get(signPublicFile({ tenantId: 11, file: gone })!)).status === 404);
  } finally {
    fs.rmSync(path.join(root, SLUG_A), { recursive: true, force: true });
    fs.rmSync(path.join(root, SLUG_B), { recursive: true, force: true });
    if (originalSocial === undefined) delete process.env.SOCIAL_TOKEN_SECRET;
    else process.env.SOCIAL_TOKEN_SECRET = originalSocial;
    if (originalEmail === undefined) delete process.env.EMAIL_TOKEN_SECRET;
    else process.env.EMAIL_TOKEN_SECRET = originalEmail;
  }
  console.log(`\npublic attachment route: ${passed} checks passed.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
