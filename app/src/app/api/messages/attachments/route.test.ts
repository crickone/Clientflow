// Run: npm test -- src/app/api/messages/attachments/route.test.ts
//
// The attachment upload route: an allowed PDF is stored in the CURRENT
// business's private inbox-media folder and answered with a ticket that
// loadAttachments turns back into the same bytes; an SVG, bytes that do not
// match the declared type, a file over 16 MB and a missing file are refused;
// signed out is a 401. The session guard and the current-tenant lookup are
// stubbed (no Next request context in this runner), as in
// src/app/api/inbox/media/[file]/route.test.ts; the storage is real.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { createRequire } from "node:module";

const SLUG = "attachments-route-test";
const TENANT_ID = 990_101;
let signedIn = true;
let tenant = { id: TENANT_ID, slug: SLUG };

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "@/lib/api/guard") {
    return { guard: async () => (signedIn ? null : new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401 })) };
  }
  if (request === "@/lib/db/tenant") {
    return {
      getCurrentTenant: () => tenant,
      getTenantById: () => undefined,
      getTenantDbById: () => {
        throw new Error("not used by the route");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);
const originalSocial = process.env.SOCIAL_TOKEN_SECRET;
const originalEmail = process.env.EMAIL_TOKEN_SECRET;
delete process.env.SOCIAL_TOKEN_SECRET;
process.env.EMAIL_TOKEN_SECRET = "test-attachments-route-secret";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

(async () => {
  const { POST } = requireLocal("./route") as typeof import("./route");
  const { loadAttachments } = requireLocal("../../../../lib/attachments/load") as typeof import("@/lib/attachments/load");
  const root = path.join(process.cwd(), "data", "tenants");
  const dir = path.join(root, SLUG, "inbox-media");

  const upload = (file: File | string | null) => {
    const form = new FormData();
    if (file !== null) form.set("file", file);
    return POST(new Request("http://localhost/api/messages/attachments", { method: "POST", body: form }));
  };
  const files = () => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

  try {
    // 1. An allowed PDF: stored, ticket back, the ticket loads the same bytes.
    const pdfBytes = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
    const r1 = await upload(new File([pdfBytes], "Treatment plan.pdf", { type: "application/pdf" }));
    check("pdf: 200", r1.status === 200);
    const b1 = (await r1.json()) as { ok: boolean; token: string; media: { kind: string; file: string; mime: string; name?: string; size: number } };
    check("pdf: ok + token", b1.ok === true && typeof b1.token === "string" && b1.token.includes("."));
    check("pdf: media record", b1.media.kind === "file" && b1.media.mime === "application/pdf" && b1.media.name === "Treatment plan.pdf" && b1.media.size === pdfBytes.length);
    check("pdf: random stored name", /^[a-f0-9]{32}\.pdf$/.test(b1.media.file));
    const stored = path.join(dir, b1.media.file);
    check("pdf: file written", fs.existsSync(stored) && fs.readFileSync(stored).equals(pdfBytes));
    check("pdf: file is private (0600)", (fs.statSync(stored).mode & 0o777) === 0o600);

    const loaded = loadAttachments([b1.token]);
    check("load: one file", loaded.length === 1);
    check("load: same bytes + record", loaded[0].bytes.equals(pdfBytes) && loaded[0].media.file === b1.media.file && loaded[0].media.mime === "application/pdf");
    check("load: repeated ticket sent once", loadAttachments([b1.token, b1.token]).length === 1);
    check("load: empty and undefined -> []", loadAttachments([]).length === 0 && loadAttachments(undefined).length === 0);
    assert.throws(() => loadAttachments(["forged.token"]), /That attachment has expired\. Attach it again\./);
    passed++;
    assert.throws(() => loadAttachments(Array.from({ length: 6 }, () => b1.token)), /up to 5 files/);
    passed++;

    // A ticket from this business does not work in another.
    tenant = { id: TENANT_ID + 1, slug: `${SLUG}-other` };
    assert.throws(() => loadAttachments([b1.token]), /That attachment has expired/);
    passed++;
    tenant = { id: TENANT_ID, slug: SLUG };

    // A ticket whose file has gone is refused.
    const r1b = await upload(new File([pdfBytes], "copy.pdf", { type: "application/pdf" }));
    const b1b = (await r1b.json()) as { token: string; media: { file: string } };
    fs.rmSync(path.join(dir, b1b.media.file));
    assert.throws(() => loadAttachments([b1.token, b1b.token]), /That attachment has expired/);
    passed++;

    const before = files().length;

    // 2. SVG is refused, nothing stored.
    const r2 = await upload(new File(["<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"], "logo.svg", { type: "image/svg+xml" }));
    const b2 = (await r2.json()) as { ok: boolean; error: string };
    check("svg: 400", r2.status === 400 && b2.ok === false);
    check("svg: plain reason", /can't be sent/.test(b2.error));

    // 3. PNG declared, PDF bytes: refused.
    const r3 = await upload(new File([pdfBytes], "photo.png", { type: "image/png" }));
    const b3 = (await r3.json()) as { ok: boolean; error: string };
    check("mismatch: 400", r3.status === 400 && b3.ok === false && /isn't what its name says/.test(b3.error));

    // 4. Over 16 MB: 413.
    const big = Buffer.alloc(16 * 1024 * 1024 + 1, 0x61);
    const r4 = await upload(new File([big], "huge.txt", { type: "text/plain" }));
    check("over 16 MB: 413", r4.status === 413);

    // 5. No file / a plain text field: 400.
    check("no file: 400", (await upload(null)).status === 400);
    check("text field instead of a file: 400", (await upload("hello")).status === 400);
    check("not multipart: 400", (await POST(new Request("http://localhost/api/messages/attachments", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }))).status === 400);

    check("refusals stored nothing", files().length === before);

    // 6. Signed out: the guard's 401, nothing stored.
    signedIn = false;
    const r6 = await upload(new File([pdfBytes], "plan.pdf", { type: "application/pdf" }));
    check("signed out: 401", r6.status === 401);
    check("signed out stored nothing", files().length === before);
    signedIn = true;
  } finally {
    fs.rmSync(path.join(root, SLUG), { recursive: true, force: true });
    if (originalSocial === undefined) delete process.env.SOCIAL_TOKEN_SECRET;
    else process.env.SOCIAL_TOKEN_SECRET = originalSocial;
    if (originalEmail === undefined) delete process.env.EMAIL_TOKEN_SECRET;
    else process.env.EMAIL_TOKEN_SECRET = originalEmail;
  }
  console.log(`\nattachments route: ${passed} checks passed.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
