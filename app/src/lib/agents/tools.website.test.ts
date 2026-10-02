// Run: npm test -- src/lib/agents/tools.website.test.ts
//
// The operator asked Adonis to swap an image on the website and was told it
// could not. These are the tools that close that, and the point of them is
// what they REFUSE to do: there is no tool here that takes HTML from the
// model, because the page template renders stored markup verbatim on the
// client's own domain, and a bespoke page's layout is a hand-built document
// that one confident rewrite destroys.
//
// So the properties worth testing are the edges, not the happy path:
// an ambiguous match, a phrase that isn't there, markup smuggled through the
// replacement text, another tenant's image, and — the one that matters most
// — that the stylesheet and scripts around the content survive every edit.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return { redirect: () => { throw new Error("redirect stub"); } };
  }
  if (request === "next/cache") return { revalidatePath: () => {} };
  if (request === "next/headers") {
    return { headers: () => { throw new Error("no request"); }, cookies: () => { throw new Error("no request"); } };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

// A page in the real shape the importer produces: stylesheet first, then the
// markup, then the scripts that animate it.
const HEAD = `<link href="https://fonts.googleapis.com/css2?family=Bebas" rel="stylesheet"/><style>:root{--gold:#c9a227}body{background:#08080a}</style>`;
const CONTENT = `<header class="head"><nav class="nav"><a href="/site/wt/about">About</a></nav></header>` +
  `<section class="hero"><h1>Clonmel's toughest gym</h1><p>Come and train with us in Clonmel.</p>` +
  `<img class="hero-img" src="/sites/wt/assets/old.jpg" alt="the gym"/></section>` +
  `<section><p>Open six days a week.</p><img src="/sites/wt/assets/two.jpg" alt="kit"/></section>` +
  `<footer class="foot"><span>Clonmel</span></footer>`;
const TAIL = `<script src="https://cdn.example/gsap.min.js"></script><script>console.log('anim');</script>`;

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById, runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const web = requireLocal("./tools.website") as typeof import("./tools.website");

  const slug = "website-tools-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const tid = (
    controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
      .get(slug, "Website Tools Test", `tenants/${slug}/${slug}.db`) as { id: number }
  ).id;

  // A second, real business — the library has a foreign key to tenants, and
  // "another tenant's image is refused" is only a real test if that tenant
  // actually exists.
  const otherSlug = "website-tools-other";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(otherSlug);
  const otherTid = (
    controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
      .get(otherSlug, "Someone Else", `tenants/${otherSlug}/${otherSlug}.db`) as { id: number }
  ).id;

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM cms_library_assets WHERE tenant_id IN (?, ?)").run(tid, otherTid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id IN (?, ?)").run(tid, otherTid);
    for (const dir of [slug, otherSlug]) {
      try {
        fs.rmSync(path.join(process.cwd(), "data", "tenants", dir), { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  };

  const ctx = { tenantId: tid, userId: 7 };
  const parse = (r: { text: string }) => JSON.parse(r.text) as Record<string, unknown>;

  try {
    getTenantDbById(tid); // create + migrate the tenant database
    const { openTenantDb } = requireLocal("../db/tenant") as typeof import("../db/tenant");
    const { sqlite } = openTenantDb(`tenants/${slug}/${slug}.db`);
    sqlite.prepare("INSERT INTO sites (slug, name, status) VALUES ('wt', 'Website Test', 'live')").run();
    const sid = (sqlite.prepare("SELECT id FROM sites WHERE slug='wt'").get() as { id: number }).id;
    sqlite
      .prepare(
        "INSERT INTO pages (site_id,page_key,path,title,template_id,status,created_at,updated_at) VALUES (?,?,?,?,'clientflow-live','published',?,?)",
      )
      .run(sid, "index", "/", "Home", Date.now(), Date.now());
    const pid = (sqlite.prepare("SELECT id FROM pages WHERE site_id=? AND path='/'").get(sid) as { id: number }).id;
    sqlite
      .prepare(
        "INSERT INTO content_blocks (site_id,page_id,name,kind,value,created_at,updated_at) VALUES (?,?,'body','html',?,?,?)",
      )
      .run(sid, pid, HEAD + CONTENT + TAIL, Date.now(), Date.now());

    const bodyNow = () =>
      (
        sqlite
          .prepare("SELECT value v FROM content_blocks WHERE site_id=? AND page_id=? AND name='body'")
          .get(sid, pid) as { v: string }
      ).v;

    await runWithTenant(tid, async () => {
      // ── READ ────────────────────────────────────────────────────────────
      const pages = parse(web.listWebsitePagesTool(ctx, {}));
      assert.equal((pages.pages as unknown[]).length, 1, "the site's page is listed");
      assert.equal((pages.pages as Array<{ editable: boolean }>)[0].editable, true, "…and reported as editable");

      const page = parse(web.readWebsitePageTool(ctx, { path: "/" }));
      assert.match(page.text as string, /Clonmel's toughest gym/, "the wording comes back");
      assert.ok(!/<h1|<section|class=/.test(page.text as string), "…with the markup stripped, not raw HTML");
      assert.deepEqual(
        (page.images as Array<{ src: string }>).map((i) => i.src),
        ["/sites/wt/assets/old.jpg", "/sites/wt/assets/two.jpg"],
        "every image is reported, in order",
      );

      assert.ok(parse(web.readWebsitePageTool(ctx, { path: "/nope" })).error, "an unknown page is refused");

      // ── EDITING TEXT ────────────────────────────────────────────────────
      const missing = parse(web.editWebsiteTextTool(ctx, { path: "/", find: "not on this page", replace: "x" }));
      assert.match(missing.error as string, /does not appear/, "a phrase that isn't there is refused");

      // "Clonmel" appears three times; the tool must not guess which.
      const ambiguous = parse(web.editWebsiteTextTool(ctx, { path: "/", find: "Clonmel", replace: "Cashel" }));
      assert.match(ambiguous.error as string, /appears 3 times/, "AN AMBIGUOUS MATCH IS REFUSED, not guessed at");
      assert.ok(bodyNow().includes("Clonmel's toughest gym"), "…and nothing was written");

      // Markup cannot be smuggled in through the replacement text. This is
      // the whole reason the write is a text substitution: the page renders
      // verbatim on the client's own domain.
      const smuggled = parse(
        web.editWebsiteTextTool(ctx, { path: "/", find: "Open six days a week.", replace: "<script>alert(1)</script>" }),
      );
      assert.match(smuggled.error as string, /plain text/, "MARKUP IN THE REPLACEMENT IS REFUSED");
      assert.ok(!bodyNow().includes("alert(1)"), "…and nothing was written");

      // A real edit.
      const ok = parse(web.editWebsiteTextTool(ctx, { path: "/", find: "Open six days a week.", replace: "Open seven days a week." }));
      assert.ok(!ok.error, `the real edit succeeds: ${ok.error ?? ""}`);
      const after = bodyNow();
      assert.ok(after.includes("Open seven days a week."), "the new wording is live");
      assert.ok(!after.includes("Open six days a week."), "…and the old wording is gone");

      // THE PROPERTY THAT MATTERS: the design survived.
      assert.ok(after.startsWith(HEAD), "THE STYLESHEET IS UNTOUCHED — it is the site's entire design");
      assert.ok(after.endsWith(TAIL), "…and so are the scripts that animate it");
      assert.ok(after.includes('<header class="head">'), "the navbar is still there");
      assert.ok(after.includes('class="hero-img"'), "…and the markup around the edit is unchanged");

      // Publishing stamps who did it, which is what stops the deploy-time
      // site sync replacing the page from the repo afterwards.
      const stamp = sqlite
        .prepare("SELECT updated_by u FROM content_blocks WHERE site_id=? AND page_id=? AND name='body'")
        .get(sid, pid) as { u: number | null };
      assert.equal(stamp.u, 7, "the edit is stamped with the operator, so a deploy will not undo it");

      // The draft is consumed, not left lying around.
      const draft = sqlite
        .prepare("SELECT count(*) c FROM content_blocks WHERE site_id=? AND page_id=? AND name='body:draft'")
        .get(sid, pid) as { c: number };
      assert.equal(draft.c, 0, "the draft is cleared once published");

      // ── REPLACING AN IMAGE ──────────────────────────────────────────────
      assert.ok(
        parse(await web.replaceWebsiteImageTool(ctx, { path: "/", currentSrc: "/sites/wt/assets/old.jpg", imageId: 999_999, source: "website" })).error,
        "an image id that does not exist is refused",
      );

      // An image belonging to ANOTHER tenant must not be usable.
      controlSqlite
        .prepare(
          "INSERT INTO cms_library_assets (tenant_id, storage_key, original_name, mime_type, size_bytes, alt) VALUES (?,?,?,?,?,?)",
        )
        .run(otherTid, "k-other", "someone-elses.jpg", "image/jpeg", 10, "not yours");
      const otherId = (
        controlSqlite.prepare("SELECT id FROM cms_library_assets WHERE storage_key='k-other'").get() as { id: number }
      ).id;
      const stolen = parse(
        await web.replaceWebsiteImageTool(ctx, { path: "/", currentSrc: "/sites/wt/assets/old.jpg", imageId: otherId, source: "website" }),
      );
      assert.match(stolen.error as string, /website images/, "ANOTHER TENANT'S IMAGE IS REFUSED");
      controlSqlite.prepare("DELETE FROM cms_library_assets WHERE id = ?").run(otherId);

      // Our own image.
      controlSqlite
        .prepare(
          "INSERT INTO cms_library_assets (tenant_id, storage_key, original_name, mime_type, size_bytes, alt) VALUES (?,?,?,?,?,?)",
        )
        .run(tid, "k-mine", "new-hero.jpg", "image/jpeg", 20, "the new hero");
      const mineId = (
        controlSqlite.prepare("SELECT id FROM cms_library_assets WHERE storage_key='k-mine'").get() as { id: number }
      ).id;

      const listed = parse(web.listWebsiteImagesTool(ctx));
      assert.ok(
        (listed.images as Array<{ imageId: number }>).some((i) => i.imageId === mineId),
        "the library lists this business's own image",
      );

      assert.ok(
        parse(await web.replaceWebsiteImageTool(ctx, { path: "/", currentSrc: "/no/such.jpg", imageId: mineId, source: "website" })).error,
        "a src that is not on the page is refused",
      );

      const swapped = parse(
        await web.replaceWebsiteImageTool(ctx, {
          path: "/",
          currentSrc: "/sites/wt/assets/old.jpg",
          source: "website",
          imageId: mineId,
          alt: "Members training in the weights room",
        }),
      );
      assert.ok(!swapped.error, `the swap succeeds: ${swapped.error ?? ""}`);

      const body = bodyNow();
      assert.ok(body.includes(`src="/library-media/${mineId}"`), "the new image is on the page");
      assert.ok(!body.includes("/sites/wt/assets/old.jpg"), "…the old one is gone");
      assert.ok(body.includes('alt="Members training in the weights room"'), "…with its new alt text");
      assert.ok(body.includes('class="hero-img"'), "THE TAG'S CLASSES SURVIVE — they are what make it fit the design");
      assert.ok(body.includes('src="/sites/wt/assets/two.jpg"'), "the OTHER image on the page is untouched");
      assert.ok(body.startsWith(HEAD) && body.endsWith(TAIL), "the stylesheet and scripts still bracket the page");

      // ── A CONTENT STUDIO PHOTO CAN GO ON THE SITE ───────────────────────
      // The business keeps its photographs in Content Studio, and the CMS
      // library started empty. Asking a client to upload everything twice to
      // put a picture on their own website is the wrong answer, so a Studio
      // photo is COPIED across the first time it is used — its own file
      // route is behind a login, so linking it directly would show visitors
      // a broken image.
      const { libraryDir } = requireLocal("../image/library") as typeof import("../image/library");
      const studioFile = "studio-photo-1.jpg";
      fs.mkdirSync(libraryDir(), { recursive: true });
      fs.writeFileSync(path.join(libraryDir(), studioFile), Buffer.from("not-a-real-jpeg-but-bytes"));
      sqlite
        .prepare(
          "INSERT INTO image_library_assets (filename, original_name, mime_type, kind, size_bytes, label) VALUES (?,?,?,?,?,?)",
        )
        .run(studioFile, "squat rack.jpg", "image/jpeg", "image", 25, "the squat rack");
      const studioId = (
        sqlite.prepare("SELECT id FROM image_library_assets WHERE filename = ?").get(studioFile) as { id: number }
      ).id;

      const both = parse(web.listWebsiteImagesTool(ctx));
      const offered = both.images as Array<{ imageId: number; name: string; source: string }>;
      assert.ok(
        offered.some((i) => i.source === "content-studio" && i.name === "squat rack.jpg"),
        "THE STUDIO PHOTO IS OFFERED alongside the website's own images",
      );
      assert.ok(offered.some((i) => i.source === "website"), "…and the website images are still listed");

      const fromStudio = parse(
        await web.replaceWebsiteImageTool(ctx, {
          path: "/",
          currentSrc: "/sites/wt/assets/two.jpg",
          imageId: studioId,
          source: "content-studio",
        }),
      );
      assert.ok(!fromStudio.error, `a Studio photo can be placed: ${fromStudio.error ?? ""}`);

      const withStudio = bodyNow();
      const copiedId = Number(/src="\/library-media\/(\d+)"/.exec(withStudio)?.[1] ?? 0);
      assert.ok(copiedId > 0, "the page points at a library id");
      assert.ok(!withStudio.includes("/sites/wt/assets/two.jpg"), "the old image is gone");
      assert.ok(
        /src="\/library-media\/\d+"/.test(withStudio),
        "…and the new one is served from the PUBLIC library route, not Studio's logged-in one",
      );
      assert.ok(!withStudio.includes("content-studio"), "no logged-in Studio URL reaches the page");

      // Using the same photo again reuses the copy rather than making another.
      const copiesBefore = (
        controlSqlite
          .prepare("SELECT count(*) c FROM cms_library_assets WHERE tenant_id = ? AND original_name LIKE 'studio-%'")
          .get(tid) as { c: number }
      ).c;
      assert.equal(copiesBefore, 1, "one copy was made");
      // Place the SAME Studio photo again, over a different image.
      await web.replaceWebsiteImageTool(ctx, {
        path: "/",
        currentSrc: `/library-media/${copiedId}`,
        imageId: studioId,
        source: "content-studio",
      });
      const copiesAfter = (
        controlSqlite
          .prepare("SELECT count(*) c FROM cms_library_assets WHERE tenant_id = ? AND original_name LIKE 'studio-%'")
          .get(tid) as { c: number }
      ).c;
      assert.equal(copiesAfter, 1, "USING IT TWICE DOES NOT COPY IT TWICE");

      // A video in the Studio library is refused — a page wants a picture.
      sqlite
        .prepare(
          "INSERT INTO image_library_assets (filename, original_name, mime_type, kind, size_bytes) VALUES (?,?,?,?,?)",
        )
        .run("clip.mp4", "a clip.mp4", "video/mp4", "video", 99);
      const vidId = (
        sqlite.prepare("SELECT id FROM image_library_assets WHERE filename='clip.mp4'").get() as { id: number }
      ).id;
      const video = parse(
        await web.replaceWebsiteImageTool(ctx, {
          path: "/",
          currentSrc: "/sites/wt/assets/old.jpg",
          imageId: vidId,
          source: "content-studio",
        }),
      );
      assert.match(video.error as string, /video, not an image/, "a video is refused");

      // ── A NEW PAGE, MADE BY COPYING ONE ─────────────────────────────────
      // The operator asked for a new page and was told it could not be done.
      // A new page is a copy of an existing one with the same text and image
      // swaps the edit tools make, so every tag on it was written by whoever
      // built the site, never by the model.
      const pageCount = () => (sqlite.prepare("SELECT count(*) c FROM pages WHERE site_id=?").get(sid) as { c: number }).c;
      const before = pageCount();
      const sourceBefore = bodyNow();
      const good = {
        copyFrom: "/",
        path: "/gift-vouchers",
        title: "Gift vouchers",
        description: "Give someone a session.",
        textChanges: [
          { find: "Clonmel's toughest gym", replace: "Gift vouchers" },
          { find: "Open seven days a week.", replace: "Any amount, any session. $& stays literal." },
        ],
      };

      for (const [bad, why] of [
        [{ ...good, path: "/blog/vouchers" }, /used by the platform/],
        [{ ...good, path: "/c" }, /used by the platform/],
        [{ ...good, path: "/" }, /home page already exists/],
        [{ ...good, path: "/Gift Vouchers!" }, /not a usable page address/],
        [{ ...good, path: "/../etc" }, /not a usable page address/],
        [{ ...good, copyFrom: "/nope" }, /No page at/],
        [{ ...good, title: "<b>x</b>" }, /plain text/],
        [{ ...good, textChanges: [] }, /needs its own wording/],
        [{ ...good, textChanges: [{ find: "Clonmel", replace: "x" }] }, /appears \d+ times/],
        [{ ...good, textChanges: [{ find: "Open seven days a week.", replace: "<script>alert(2)</script>" }] }, /plain text/],
        [{ ...good, imageChanges: [{ currentSrc: "/no/such.jpg", imageId: mineId, source: "website" }] }, /Image change 1/],
      ] as const) {
        const r = parse(await web.createWebsitePageTool(ctx, bad as unknown as Record<string, unknown>));
        assert.match(String(r.error ?? ""), why, `refused: ${JSON.stringify(bad).slice(0, 80)}`);
      }
      assert.equal(pageCount(), before, "A REFUSED CHANGE LEAVES NO HALF-MADE PAGE BEHIND");

      const made = parse(await web.createWebsitePageTool(ctx, good));
      assert.ok(!made.error, `the copy is made: ${made.error ?? ""}`);
      assert.equal(pageCount(), before + 1, "one new page");
      assert.match(String(made.result), /not live yet/, "the operator is told it is not live");
      assert.match(String(made.result), /https?:\/\/\S+\/site\/wt\/gift-vouchers\?preview=1/, "…and given a full preview link they can click");

      const newPage = sqlite
        .prepare("SELECT id, status, title, template_id t FROM pages WHERE site_id=? AND path='/gift-vouchers'")
        .get(sid) as { id: number; status: string; title: string; t: string };
      assert.equal(newPage.status, "draft", "THE NEW PAGE IS NOT PUBLIC until it is published");
      assert.equal(newPage.title, "Gift vouchers");
      assert.equal(newPage.t, "clientflow-live", "it renders with the same template as the page it copied");

      const newBody = (
        sqlite.prepare("SELECT value v, updated_by u FROM content_blocks WHERE site_id=? AND page_id=? AND name='body'").get(sid, newPage.id) as {
          v: string;
          u: number | null;
        }
      );
      assert.ok(newBody.v.startsWith(HEAD) && newBody.v.endsWith(TAIL), "THE COPY KEEPS THE DESIGN: same stylesheet, same scripts");
      assert.ok(newBody.v.includes("<h1>Gift vouchers</h1>"), "the wording changed inside the original markup");
      assert.ok(newBody.v.includes("$& stays literal."), "replacement text is taken literally, never as a regex pattern");
      assert.ok(!newBody.v.includes("Clonmel's toughest gym"), "the old heading is gone from the copy");
      assert.equal(newBody.u, 7, "stamped with the operator, so a deploy never overwrites it");
      assert.equal(bodyNow(), sourceBefore, "THE PAGE IT WAS COPIED FROM IS UNTOUCHED");

      const seo = sqlite
        .prepare("SELECT seo_title t, seo_description d, canonical_url c FROM seo_meta WHERE site_id=? AND page_id=?")
        .get(sid, newPage.id) as { t: string; d: string; c: string | null };
      assert.equal(seo.t, "Gift vouchers");
      assert.equal(seo.d, "Give someone a session.");
      assert.equal(seo.c, null, "the source page's canonical URL is not carried over");

      assert.match(
        String(parse(await web.createWebsitePageTool(ctx, good)).error),
        /already a page at/,
        "the same address cannot be taken twice",
      );

      // Edits work on the unpublished page, and say so.
      const draftEdit = parse(web.editWebsiteTextTool(ctx, { path: "/gift-vouchers", find: "Gift vouchers", replace: "Gift cards" }));
      assert.match(String(draftEdit.result), /not published yet/, "an edit to a draft page does not claim to be live");

      // Publishing.
      assert.ok(parse(web.publishWebsitePageTool(ctx, { path: "/nope" })).error, "publishing a page that isn't there is refused");
      const pub = parse(web.publishWebsitePageTool(ctx, { path: "/gift-vouchers" }));
      assert.match(String(pub.result), /now live/, "the page goes live");
      assert.equal(
        (sqlite.prepare("SELECT status s FROM pages WHERE id=?").get(newPage.id) as { s: string }).s,
        "published",
        "…and its status says so",
      );
    });

    console.log("tools.website.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
