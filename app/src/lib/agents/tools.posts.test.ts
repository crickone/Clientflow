// Run: npm test -- src/lib/agents/tools.posts.test.ts
//
// Verifies the social-posts-from-the-chat tools (tools.posts.ts):
//   - create_social_post is a WRITE (in WRITE_TOOLS, so it waits for an
//     operator Approve); list_social_posts / export_social_posts are READs;
//     all three are registered in TOOLS and in Adonis's tool slice.
//   - create_social_post rejects a missing name/topic BEFORE creating
//     anything, and on valid input creates a carousel_sets row and queues
//     exactly one generation for it (the queue is stubbed: this environment
//     has no Claude credentials, and a real run is minutes of model calls).
//   - list_social_posts reports an honest status per design (writing / failed
//     / ready) and how many slides actually have renders on disk.
//   - export_social_posts zips ONLY the rendered slides, a folder per post
//     with numbered PNGs plus the caption, attaches the zip as a chat
//     artifact, and names every post it left out and why (still writing,
//     unknown id, no renders).
//
// NOTE: this repo does NOT use vitest — tests are plain node:assert/strict
// scripts run via `npm test -- <path>` (see scripts/test.mjs). Same
// Module._load shim as tools.marketing.test.ts, for the same reasons, plus a
// stub for the generation queue (see above).
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;

/** Every generation the tools queued, in order — asserted on below. */
const queued: { carouselId: number; topic: string; slideCount: number; slotKey: string }[] = [];

mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in tools.posts.test.ts");
      },
    };
  }
  if (request === "@/lib/image/carouselGeneration" || request.endsWith("/image/carouselGeneration")) {
    return {
      enqueueCarouselGeneration: (input: (typeof queued)[number]) => {
        queued.push(input);
      },
      queueCarouselGeneration: (input: (typeof queued)[number]) => {
        queued.push(input);
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById, runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { TOOLS, WRITE_TOOLS } = requireLocal("../assistant/tools") as typeof import("../assistant/tools");
  const { SPECIALISTS } = requireLocal("./specialists") as typeof import("./specialists");
  const { createSocialPostTool, listSocialPostsTool, exportSocialPostsTool } =
    requireLocal("./tools.posts") as typeof import("./tools.posts");
  const { createCarousel, addSlide, getCarousel, setGenerationStatus } =
    requireLocal("../image/carousels") as typeof import("../image/carousels");
  const { renderFilePath } = requireLocal("../image/renderStore") as typeof import("../image/renderStore");
  const { readDownload } = requireLocal("../assistant/downloadStore") as typeof import("../assistant/downloadStore");
  const { DESIGNED_TEMPLATE_ID } = requireLocal("../image/paintSlide") as typeof import("../image/paintSlide");

  const slug = "agents-posts-tools-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Agents Posts Tools Test", dbFile) as { id: number };
  const tid = t.id;
  const ctx = { tenantId: tid };

  // Fake renders on disk, under the names the slides will point at. Content
  // is arbitrary: the export copies bytes, it does not decode them.
  const renderA = "design-test-posts-aaaa.png";
  const renderB = "design-test-posts-bbbb.png";
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
    for (const f of [renderA, renderB, "design-test-posts-cccc.png"]) {
      try {
        fs.unlinkSync(renderFilePath(f));
      } catch {
        // best effort
      }
    }
  };

  try {
    // ── (a) the gate: create is a write, list/export are reads; all three
    // registered and in Adonis's slice ──
    assert.ok(WRITE_TOOLS.has("create_social_post"), "create_social_post is a write tool (requires Approve)");
    assert.ok(!WRITE_TOOLS.has("list_social_posts"), "list_social_posts is a read tool");
    assert.ok(!WRITE_TOOLS.has("export_social_posts"), "export_social_posts is a read tool");
    const toolNames = new Set(TOOLS.map((tool) => tool.name));
    const adonis = new Set(SPECIALISTS.orchestrator.toolNames);
    for (const name of ["create_social_post", "list_social_posts", "export_social_posts"]) {
      assert.ok(toolNames.has(name), `"${name}" is registered in TOOLS`);
      assert.ok(adonis.has(name), `"${name}" is in Adonis's tool slice`);
    }

    getTenantDbById(tid); // provisions the scratch tenant's tables

    // ── (b) create_social_post: validation happens before any row exists ──
    const noName = JSON.parse(runWithTenant(tid, () => createSocialPostTool(ctx, { topic: "HBOT for recovery" })).text);
    assert.ok(noName.error, "create_social_post requires a name");
    const noTopic = JSON.parse(runWithTenant(tid, () => createSocialPostTool(ctx, { name: "Mon post" })).text);
    assert.ok(noTopic.error, "create_social_post requires a topic");
    assert.equal(queued.length, 0, "nothing is queued for a rejected create");
    assert.equal(
      JSON.parse(runWithTenant(tid, () => listSocialPostsTool(ctx, {})).text).count,
      0,
      "a rejected create leaves no design behind",
    );

    // ── (c) a valid create makes the row and queues exactly one generation
    // with the brief and the carousel slot ──
    const created = JSON.parse(
      runWithTenant(tid, () =>
        createSocialPostTool(ctx, { name: "Mon - Why HBOT helps recovery", topic: "How HBOT speeds up recovery after training", slideCount: 4 }),
      ).text,
    );
    assert.ok(!created.error, `create_social_post succeeds: ${created.error ?? ""}`);
    assert.equal(created.status, "writing");
    assert.equal(created.slideCount, 4);
    assert.equal(typeof created.postId, "number");
    assert.equal(created.editorUrl, `/content-studio/images/${created.postId}`);
    assert.equal(queued.length, 1, "exactly one generation queued");
    assert.equal(queued[0].carouselId, created.postId);
    assert.equal(queued[0].slideCount, 4);
    assert.equal(queued[0].slotKey, "carousel-content", "the post is queued into the carousel slot");
    assert.match(queued[0].topic, /HBOT/);
    assert.equal(runWithTenant(tid, () => getCarousel(created.postId))?.name, "Mon - Why HBOT helps recovery");

    // A single-image post: one slide, queued into the single-image slot.
    const single = JSON.parse(
      runWithTenant(tid, () =>
        createSocialPostTool(ctx, { format: "single", name: "Fri - One line on rest days", topic: "Rest days are training too", slideCount: 7 }),
      ).text,
    );
    assert.ok(!single.error, `single create succeeds: ${single.error ?? ""}`);
    assert.equal(single.format, "single");
    assert.equal(single.slideCount, 1, "a single is one slide whatever slideCount says");
    assert.equal(queued[queued.length - 1].slotKey, "default", "a single is queued into the single-image slot");
    assert.equal(queued[queued.length - 1].slideCount, 1);

    // Out-of-range slide counts are clamped, not rejected.
    const clamped = JSON.parse(
      runWithTenant(tid, () => createSocialPostTool(ctx, { name: "Tue", topic: "PEMF", slideCount: 40 })).text,
    );
    assert.equal(clamped.slideCount, 10, "slideCount is clamped to 10");

    // ── (d) seed the states an export has to tell apart. The queue is
    // stubbed, so rows created above sit at whatever status the stub left:
    // none. Set them explicitly. ──
    const writingId = created.postId as number; // still "writing" in real life
    runWithTenant(tid, () => setGenerationStatus(writingId, "writing"));

    // A finished designed post: two rendered slides + a caption, plus one
    // slide whose render failed (no file) that must NOT ship.
    fs.writeFileSync(renderFilePath(renderA), Buffer.from("png-a"));
    fs.writeFileSync(renderFilePath(renderB), Buffer.from("png-b"));
    const ready = runWithTenant(tid, () => createCarousel({ name: "Wed - Infrared sauna myths" }));
    runWithTenant(tid, () => {
      addSlide({ carouselSetId: ready.id, slotKey: "carousel-content", templateId: DESIGNED_TEMPLATE_ID, aspectRatio: "1:1", caption: "Three myths about infrared, busted.", renderFilename: renderA });
      addSlide({ carouselSetId: ready.id, slotKey: "carousel-content", templateId: DESIGNED_TEMPLATE_ID, aspectRatio: "1:1", renderFilename: renderB });
      addSlide({ carouselSetId: ready.id, slotKey: "carousel-content", templateId: DESIGNED_TEMPLATE_ID, aspectRatio: "1:1", renderFilename: "design-does-not-exist.png" });
    });

    // A finished SINGLE: one designed slide in the default slot.
    const renderC = "design-test-posts-cccc.png";
    fs.writeFileSync(renderFilePath(renderC), Buffer.from("png-c"));
    const readySingle = runWithTenant(tid, () => createCarousel({ name: "Fri - Rest days" }));
    runWithTenant(tid, () => {
      addSlide({ carouselSetId: readySingle.id, slotKey: "default", templateId: DESIGNED_TEMPLATE_ID, aspectRatio: "1:1", caption: "Rest is part of the plan.", renderFilename: renderC });
    });

    // A template-style design: slides but nothing rendered server-side.
    const templated = runWithTenant(tid, () => createCarousel({ name: "Thu - template only" }));
    runWithTenant(tid, () => {
      addSlide({ carouselSetId: templated.id, slotKey: "carousel-content", templateId: "carousel-cover", aspectRatio: "1:1", headingText: "H" });
    });

    // ── (e) list_social_posts reports each honestly ──
    const listed = JSON.parse(runWithTenant(tid, () => listSocialPostsTool(ctx, {})).text);
    const byId = new Map<number, Record<string, unknown>>(listed.posts.map((p: { id: number }) => [p.id, p]));
    assert.equal(byId.get(writingId)?.status, "writing");
    assert.equal(byId.get(writingId)?.exportable, false);
    assert.equal(byId.get(ready.id)?.status, "ready");
    assert.equal(byId.get(ready.id)?.renderedSlides, 2, "only slides with a render on disk count");
    assert.equal(byId.get(ready.id)?.exportable, true);
    assert.equal(byId.get(ready.id)?.format, "carousel");
    assert.equal(byId.get(readySingle.id)?.format, "single");
    assert.equal(byId.get(readySingle.id)?.exportable, true, "a rendered single is exportable");
    assert.equal(byId.get(templated.id)?.status, "ready");
    assert.equal(byId.get(templated.id)?.exportable, false, "a template-style design is not exportable from the chat");

    // ── (f) export_social_posts: one zip, the rendered post in, the rest
    // named with a reason, artifact attached ──
    const exported = await runWithTenant(tid, () =>
      exportSocialPostsTool(ctx, { postIds: [ready.id, readySingle.id, writingId, templated.id, 999999] }),
    );
    const body = JSON.parse(exported.text);
    assert.ok(!body.error, `export succeeds: ${body.error ?? ""}`);
    assert.deepEqual(
      body.included.map((p: { id: number }) => p.id),
      [ready.id, readySingle.id],
      "only the rendered posts are included, in the order asked for",
    );
    assert.equal(body.included[0].slides, 2);
    assert.equal(body.included[1].slides, 1);
    const skippedIds = body.skipped.map((s: { id: number }) => s.id).sort((a: number, b: number) => a - b);
    assert.deepEqual(skippedIds, [writingId, templated.id, 999999].sort((a, b) => a - b), "every other post is named as skipped");
    assert.match(body.skipped.find((s: { id: number }) => s.id === writingId).reason, /still being designed/i);
    assert.match(body.skipped.find((s: { id: number }) => s.id === templated.id).reason, /Content Studio/);
    assert.match(body.skipped.find((s: { id: number }) => s.id === 999999).reason, /No post/);

    assert.ok(exported.artifact, "the zip is attached as a chat artifact");
    assert.match(exported.artifact!.url, /^\/api\/assistant\/download\/[a-f0-9]{32}$/);
    assert.match(exported.artifact!.label, /2 posts/);

    const downloadId = exported.artifact!.url.split("/").pop()!;
    const stored = readDownload(tid, downloadId);
    assert.ok(stored, "the download is stored for this tenant");
    assert.equal(readDownload(tid + 1, downloadId), null, "another tenant cannot read it");
    const zip = await JSZip.loadAsync(stored!.bytes);
    const files = Object.keys(zip.files).filter((f) => !zip.files[f].dir).sort();
    assert.deepEqual(files, [
      "01-wed-infrared-sauna-myths/01.png",
      "01-wed-infrared-sauna-myths/02.png",
      "01-wed-infrared-sauna-myths/caption.txt",
      "02-fri-rest-days/01.png",
      "02-fri-rest-days/caption.txt",
    ]);
    assert.equal(await zip.file("02-fri-rest-days/01.png")!.async("string"), "png-c");
    assert.equal(await zip.file("01-wed-infrared-sauna-myths/01.png")!.async("string"), "png-a");
    assert.equal(await zip.file("01-wed-infrared-sauna-myths/caption.txt")!.async("string"), "Three myths about infrared, busted.");

    // Nothing ready at all is an error result, not an empty zip.
    const nothing = JSON.parse((await runWithTenant(tid, () => exportSocialPostsTool(ctx, { postIds: [writingId] }))).text);
    assert.ok(nothing.error, "exporting only unfinished posts returns an error, not an empty zip");
    assert.equal(nothing.skipped.length, 1);

    console.log("tools.posts.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
