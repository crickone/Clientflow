// Run: npm test -- src/lib/inbox/media.test.ts
//
// Inbox photos and attachments: a stored message's attachment is downloaded
// (fetch mocked here, no network), written under a random name in the
// business's private data/tenants/<slug>/inbox-media/ folder, and the media
// JSON lands on that message row. Everything that can go wrong (too big, an
// HTML error page, a timeout, a dead first link) is skipped without throwing.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// Any real network call fails the test.
globalThis.fetch = (async () => {
  throw new Error("network used in a test");
}) as typeof fetch;

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("@/lib/db/control");
  const { openTenantDb } = requireLocal("../db/tenant") as typeof import("@/lib/db/tenant");
  const media = requireLocal("./media") as typeof import("./media");
  const { parseMedia } = requireLocal("./mediaModel") as typeof import("./mediaModel");

  const slug = "inbox-media-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  const tenantDir = path.join(process.cwd(), "data", "tenants", slug);
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const { id: tid } = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Inbox Media Test", dbFile) as { id: number };

  try {
    const { sqlite } = openTenantDb(dbFile);
    const cols = (sqlite.prepare("PRAGMA table_info(lead_messages)").all() as Array<{ name: string }>).map((c) => c.name);
    check("lead_messages has the media column", cols.includes("media"));
    const ccols = (sqlite.prepare("PRAGMA table_info(client_messages)").all() as Array<{ name: string }>).map((c) => c.name);
    check("client_messages has the media column", ccols.includes("media"));

    const { id: leadId } = sqlite.prepare("INSERT INTO leads (source, first_name) VALUES ('manual', 'Test') RETURNING id").get() as { id: number };
    const addMsg = (content: string) =>
      (sqlite.prepare("INSERT INTO lead_messages (lead_id, direction, channel, content) VALUES (?, 'inbound', 'messenger', ?) RETURNING id").get(leadId, content) as { id: number }).id;
    const mediaOf = (id: number) => (sqlite.prepare("SELECT media, content FROM lead_messages WHERE id = ?").get(id) as { media: string | null; content: string });

    // 1. A photo downloads, is saved, and its JSON lands on the row.
    const calls: Array<{ url: string; headers?: HeadersInit }> = [];
    const okFetch = async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: init?.headers });
      return new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg", "content-length": String(JPEG.length) } });
    };
    const m1 = addMsg("[Photo]");
    const kept = await media.ingestMessageMedia({
      tenantId: tid,
      owner: "lead",
      messageId: m1,
      attachments: [{ kind: "image", sources: [{ url: "https://cdn.example.test/p.jpg?sig=1" }] }],
      fetchImpl: okFetch,
    });
    check("one photo kept", kept.length === 1 && kept[0].kind === "image" && kept[0].mime === "image/jpeg" && kept[0].size === JPEG.length);
    check("random unguessable name", /^[a-f0-9]{32}\.jpg$/.test(kept[0].file));
    const onDisk = path.join(tenantDir, "inbox-media", kept[0].file);
    check("file written in the business's private folder", fs.existsSync(onDisk) && fs.readFileSync(onDisk).equals(JPEG));
    check("never under public/", !onDisk.includes(`${path.sep}public${path.sep}`));
    const row = mediaOf(m1);
    check("media JSON saved on the row", parseMedia(row.media).length === 1 && parseMedia(row.media)[0].file === kept[0].file);
    check("placeholder text kept for AI triage", row.content === "[Photo]");
    check("the mocked fetch was used", calls.length === 1 && calls[0].url === "https://cdn.example.test/p.jpg?sig=1");

    // 2. First source fails, the second (token) source works; the declared mime wins over a vague header.
    const tries: string[] = [];
    const m2 = addMsg("[Voice note]");
    const kept2 = await media.ingestMessageMedia({
      tenantId: tid,
      owner: "lead",
      messageId: m2,
      attachments: [{ kind: "audio", mime: "audio/ogg; codecs=opus", sources: [{ url: "https://files.example.test/v.ogg" }, { url: "https://gate.example.test/media/abc", headers: { Authorization: "Bearer t" } }] }],
      fetchImpl: async (url) => {
        tries.push(url);
        return url.includes("files.") ? new Response("gone", { status: 404 }) : new Response(Buffer.from("OggS-data"), { status: 200, headers: { "content-type": "application/octet-stream" } });
      },
    });
    check("falls back to the next source", tries.length === 2 && kept2.length === 1);
    check("declared audio type used when the header is vague", kept2[0]?.mime === "audio/ogg" && kept2[0].file.endsWith(".ogg") && kept2[0].kind === "audio");

    // 3. Everything that must be skipped, without throwing, placeholder left alone.
    const m3 = addMsg("[Photo]");
    const kept3 = await media.ingestMessageMedia({
      tenantId: tid,
      owner: "lead",
      messageId: m3,
      attachments: [
        { kind: "image", size: 30 * 1024 * 1024, sources: [{ url: "https://cdn.example.test/huge.jpg" }] },
        { kind: "image", sources: [{ url: "https://cdn.example.test/login" }] },
        { kind: "image", sources: [{ url: "https://cdn.example.test/slow.jpg" }] },
        { kind: "image", sources: [{ url: "http://cdn.example.test/plain.jpg" }] },
        { kind: "image", sources: [{ url: "https://cdn.example.test/big-header.jpg" }] },
      ],
      fetchImpl: async (url, init) => {
        if (url.endsWith("/login")) return new Response("<html>sign in</html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
        if (url.endsWith("big-header.jpg")) return new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg", "content-length": String(26 * 1024 * 1024) } });
        if (url.endsWith("slow.jpg")) {
          const err = new Error("The operation was aborted due to timeout");
          err.name = "TimeoutError";
          assert.ok(init?.signal, "every download carries a timeout signal");
          throw err;
        }
        throw new Error("should not be fetched: " + url);
      },
    });
    check("too big, HTML page, timeout, http and over-cap header all skipped", kept3.length === 0);
    check("row left with no media and its placeholder", mediaOf(m3).media === null && mediaOf(m3).content === "[Photo]");

    // 4. A type we do not show is still kept as a plain file within the cap.
    const r4 = await media.downloadAttachment(
      { kind: "file", sources: [{ url: "https://cdn.example.test/x.zip" }] },
      { fetchImpl: async () => new Response(Buffer.from("PK"), { status: 200, headers: { "content-type": "application/zip" } }) },
    );
    check("unknown type downloads", r4.ok);
    if (r4.ok) {
      const saved = media.saveMediaFile(slug, r4.buf, r4.mime, "archive.zip");
      check("unknown type stored as a .bin file, octet-stream", saved.kind === "file" && saved.file.endsWith(".bin") && saved.mime === "application/octet-stream" && saved.name === "archive.zip");
    }

    // 5. A stored body is capped while reading, even with no content-length.
    const r5 = await media.downloadAttachment(
      { kind: "image", sources: [{ url: "https://cdn.example.test/stream.jpg" }] },
      { maxBytes: 4, fetchImpl: async () => new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg" } }) },
    );
    check("body over the cap is refused while reading", !r5.ok);

    // 6. Paths.
    check("traversal name refused", media.inboxMediaPath(slug, "../inbox-media-test.db") === null && media.inboxMediaPath(slug, "..%2f..%2fx.jpg") === null);
    check("stored name resolves inside the folder", media.inboxMediaPath(slug, kept[0].file) === onDisk);
    check("bad tenant slug throws", (() => { try { media.inboxMediaDir("../x"); return false; } catch { return true; } })());
  } finally {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    fs.rmSync(tenantDir, { recursive: true, force: true });
  }
  console.log(`\ninbox media: ${passed} checks passed.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
