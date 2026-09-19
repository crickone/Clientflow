#!/usr/bin/env node
/**
 * Pull a Webflow blog across into the CMS as markdown.
 *
 * Written for one job: Inspire Health & Fitness has 25 published articles on
 * the site we are replacing, and a launch that quietly drops them loses the
 * client every piece of writing they have and every search result pointing at
 * it. This reads the live pages and produces a JSON file the boot importer can
 * seed from, so the move is repeatable and reviewable rather than 25 rounds of
 * copy and paste.
 *
 * It is deliberately conservative about the conversion: Webflow rich text is a
 * small, predictable subset of HTML (headings, paragraphs, lists, bold, links,
 * images, blockquotes), and anything outside that subset is dropped rather
 * than guessed at. Output is checked with --report before anything is written
 * anywhere near a database.
 *
 * Four things it fixes on the way through, each found by looking at the real
 * output rather than guessed at in advance:
 *
 *   - every post's og:image was the site LOGO, so importing covers verbatim
 *     would have given 25 identical logo cards. --drop-cover discards them,
 *     and the REAL cover is read off the index instead: the card image sits
 *     immediately before its own post link, which is the only place on the
 *     whole site where each article's hero is unambiguously its own. (A post
 *     page cannot be used — it carries a "related posts" strip holding every
 *     other article's image too.)
 *   - images live on the old host's CDN and die when that site is taken down,
 *     so --assets downloads them and rewrites the links.
 *   - internal links pointed at the old absolute domain; they are rewritten to
 *     the CMS's own paths, the same shape tools/import-site.cjs produces.
 *   - some headings were wrapped in bold, which renders as bold-on-bold.
 *
 * Usage:
 *   node tools/scrape-webflow-blog.cjs --index https://example.ie/blog \
 *     --prefix /blog-posts/ --site-slug inspire --site-host www.example.ie \
 *     --assets app/public/sites/inspire/blog --drop-cover logo \
 *     --exclude a-slug,another-slug --out app/public/sites/inspire/_posts.json
 *   node tools/scrape-webflow-blog.cjs --report app/public/sites/inspire/_posts.json
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
// sharp lives in the app's node_modules, same as better-sqlite3 does for the
// other tools in here.
const sharp = require(path.join(ROOT, "app", "node_modules", "sharp"));

/** Widest an image needs to be here; the CDN serves originals up to 6000px. */
const MAX_IMAGE_WIDTH = 1600;
/** Above this, re-encode even a correctly-sized image. */
const MAX_IMAGE_BYTES = 400 * 1024;

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : def;
};

const decode = (s) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2019;/g, "’");

const stripTags = (s) => decode(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

/**
 * Find the element whose class list contains `w-richtext` and return its inner
 * HTML, by counting <div> depth from the opening tag. A regex cannot match
 * balanced tags, and the post body is nested several levels deep.
 */
function extractRichText(html) {
  const open = /<div[^>]*class="[^"]*w-richtext[^"]*"[^>]*>/i.exec(html);
  if (!open) return null;
  const start = open.index + open[0].length;
  let depth = 1;
  const tag = /<(\/?)div\b[^>]*>/gi;
  tag.lastIndex = start;
  let m;
  while ((m = tag.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index);
  }
  return null;
}

/** Inline HTML -> markdown. Only the marks Webflow's editor can produce. */
function inline(s) {
  return decode(
    s
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) => `**${stripTags(inner)}**`)
      .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) => `*${stripTags(inner)}*`)
      .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, inner) => {
        const text = stripTags(inner);
        return text ? `[${text}](${href})` : "";
      })
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Block-level HTML -> markdown. */
function toMarkdown(html) {
  const out = [];
  // Walk top-level blocks in document order.
  const block = /<(h[1-6]|p|ul|ol|blockquote|figure)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = block.exec(html))) {
    const tag = m[1].toLowerCase();
    const inner = m[2];
    if (/^h[1-6]$/.test(tag)) {
      const text = inline(inner);
      // Webflow posts repeat the article title as an H1 in the body; the CMS
      // renders the title itself, so demote to keep one H1 per page.
      const level = Math.max(2, Number(tag[1]));
      if (text) out.push(`${"#".repeat(level)} ${text}`);
    } else if (tag === "p") {
      const text = inline(inner);
      if (text) out.push(text);
    } else if (tag === "ul" || tag === "ol") {
      const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
        .map((li, i) => {
          const text = inline(li[1]);
          return text ? `${tag === "ul" ? "-" : `${i + 1}.`} ${text}` : "";
        })
        .filter(Boolean);
      if (items.length) out.push(items.join("\n"));
    } else if (tag === "blockquote") {
      const text = inline(inner);
      if (text) out.push(text.split("\n").map((l) => `> ${l}`).join("\n"));
    } else if (tag === "figure") {
      const img = /<img\b[^>]*src="([^"]*)"[^>]*>/i.exec(inner);
      const alt = img ? (/alt="([^"]*)"/i.exec(img[0]) || [, ""])[1] : "";
      if (img) out.push(`![${decode(alt)}](${img[1]})`);
    }
  }
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "user-agent": "AdonisAgent site migration" } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.text();
}

// ── report mode ─────────────────────────────────────────────────────────────
const reportFile = arg("report");
if (reportFile) {
  const posts = JSON.parse(fs.readFileSync(path.resolve(reportFile), "utf8")).posts;
  console.log(`${posts.length} posts\n`);
  for (const p of posts) {
    const words = p.content.trim().split(/\s+/).length;
    const flags = [];
    if (words < 150) flags.push("SHORT");
    if (!p.excerpt) flags.push("no-excerpt");
    if (!p.coverImageUrl) flags.push("no-cover");
    if (/<[a-z]/i.test(p.content)) flags.push("HTML-LEFTOVER");
    console.log(`${String(words).padStart(5)}w  ${p.slug}${flags.length ? "   [" + flags.join(" ") + "]" : ""}`);
  }
  process.exit(0);
}

// ── scrape mode ─────────────────────────────────────────────────────────────
(async () => {
  const indexUrl = arg("index");
  const prefix = arg("prefix", "/blog-posts/");
  const out = arg("out");
  const siteSlug = arg("site-slug");
  const siteHost = arg("site-host");
  const assetsDir = arg("assets");
  const dropCover = arg("drop-cover");
  const excluded = (arg("exclude", "") || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!indexUrl || !out) {
    console.error("Required: --index <blog index url> --out <file.json>  (or --report <file.json>)");
    process.exit(1);
  }
  const origin = new URL(indexUrl).origin;

  const index = await fetchText(indexUrl);
  const slugs = [...new Set([...index.matchAll(new RegExp(`href="${prefix}([^"#?]+)"`, "gi"))].map((m) => m[1]))];
  console.log(`${slugs.length} posts linked from ${indexUrl}\n`);

  /**
   * Each card's hero image, taken from the index in document order: an image
   * belongs to the next post link that follows it, unless another image gets
   * there first. Anchoring on position rather than a class name keeps this
   * working on a differently-themed export of the same CMS.
   *
   * `src` deliberately, not the widest entry in `srcset` — these originals
   * run to 6000px, and the resize on the way in would only throw that away.
   */
  const coverBySlug = new Map();
  {
    const marks = [];
    for (const m of index.matchAll(/<img\b[^>]*\bsrc="(https:\/\/[^"]+)"[^>]*>/gi)) {
      marks.push({ at: m.index ?? 0, kind: "img", value: m[1] });
    }
    for (const m of index.matchAll(new RegExp(`href="${prefix}([^"#?]+)"`, "gi"))) {
      marks.push({ at: m.index ?? 0, kind: "link", value: m[1] });
    }
    marks.sort((a, b) => a.at - b.at);
    let pending = null;
    for (const mark of marks) {
      if (mark.kind === "img") pending = mark.value;
      else if (pending && !coverBySlug.has(mark.value)) {
        coverBySlug.set(mark.value, pending);
        pending = null;
      }
    }
    console.log(`${coverBySlug.size} card images matched to posts on the index\n`);
  }

  /**
   * Bring an image onto our own host. An article that keeps pointing at the
   * old site's CDN looks fine right up until that site is switched off, which
   * is the whole point of this migration.
   */
  const savedAssets = new Map();
  async function localiseImage(url) {
    if (!assetsDir || !siteSlug) return url;
    if (savedAssets.has(url)) return savedAssets.get(url);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "image")
        .replace(/[^a-zA-Z0-9._-]/g, "-")
        .replace(/-+/g, "-");
      fs.mkdirSync(path.resolve(assetsDir), { recursive: true });
      const original = Buffer.from(await res.arrayBuffer());

      // The source CDN serves originals — the one image in this blog was
      // 4096px wide and 1.8 MB, which is most of a page-weight budget for a
      // picture nobody will see above 800px. Re-encode anything oversized.
      let out = original;
      let note = `${(original.length / 1024).toFixed(0)} KB`;
      try {
        const meta = await sharp(original).metadata();
        const tooWide = Boolean(meta.width && meta.width > MAX_IMAGE_WIDTH);
        // Width alone is not enough: one card image was a correctly-sized
        // PNG weighing 1.5 MB, which costs a visitor more than a 6000px JPEG
        // that gets resized. Judge by what actually crosses the wire.
        const tooHeavy = original.length > MAX_IMAGE_BYTES;
        if (tooWide || tooHeavy) {
          const pipeline = sharp(original);
          if (tooWide) pipeline.resize({ width: MAX_IMAGE_WIDTH });
          const encoded = await pipeline.jpeg({ quality: 82 }).toBuffer();
          // Only keep the re-encode if it actually helped; a small PNG of flat
          // colour can come out BIGGER as a JPEG.
          if (encoded.length < original.length) {
            out = encoded;
            note =
              `${meta.width ?? "?"}px ${(original.length / 1024).toFixed(0)} KB -> ` +
              `${tooWide ? MAX_IMAGE_WIDTH : (meta.width ?? "?")}px ${(out.length / 1024).toFixed(0)} KB`;
          } else {
            note = `${(original.length / 1024).toFixed(0)} KB (re-encode was larger, kept original)`;
          }
        }
      } catch {
        // Not something sharp understands (an SVG, say) — keep the original.
      }

      fs.writeFileSync(path.join(path.resolve(assetsDir), name), out);
      const served = `/sites/${siteSlug}/blog/${name}`;
      savedAssets.set(url, served);
      console.log(`       saved image ${name} (${note})`);
      return served;
    } catch (err) {
      console.error(`       image failed (${url}): ${err.message} — left pointing at the old host`);
      savedAssets.set(url, url);
      return url;
    }
  }

  /** Old absolute internal links -> the CMS's own paths. */
  function rewriteLinks(markdown) {
    if (!siteHost || !siteSlug) return markdown;
    const host = siteHost.replace(/^www\./, "");
    const re = new RegExp(`https?://(?:www\\.)?${host.replace(/\./g, "\\.")}(/[^)\\s]*)?`, "gi");
    return markdown.replace(re, (_m, p1) => {
      const rest = (p1 || "").replace(/\/$/, "");
      return rest ? `/site/${siteSlug}${rest}` : `/site/${siteSlug}`;
    });
  }

  const posts = [];
  const skipped = [];
  for (const slug of slugs) {
    if (excluded.includes(slug)) {
      skipped.push(slug);
      console.log(`  skip ${slug}  (excluded)`);
      continue;
    }
    const url = `${origin}${prefix}${slug}`;
    try {
      const html = await fetchText(url);
      const rich = extractRichText(html);
      if (!rich) {
        console.error(`  SKIP ${slug} — no rich-text body found`);
        continue;
      }
      const rawTitle = (/<title>([\s\S]*?)<\/title>/i.exec(html) || [, slug])[1];
      // Webflow appends the site name; the post's own H1 is the better title.
      const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
      const title = h1 ? stripTags(h1[1]) : decode(rawTitle).split("|")[0].trim();
      const desc = (/<meta\s+name="description"\s+content="([^"]*)"/i.exec(html) || [, ""])[1];
      const ogImage = (/<meta\s+property="og:image"\s+content="([^"]*)"/i.exec(html) || [, ""])[1];
      // Fall back to the first image inside the article.
      const firstImg = (/<img\b[^>]*src="(https:\/\/cdn\.prod\.website-files\.com[^"]*)"/i.exec(html) || [, ""])[1];
      let content = toMarkdown(rich);
      // A heading is already emphasis; **bold** inside one renders bold-on-bold.
      content = content.replace(/^(#{2,6}) \*\*(.+?)\*\*\s*$/gm, "$1 $2");
      content = rewriteLinks(content);
      for (const [, url] of [...content.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/g)]) {
        const local = await localiseImage(url);
        if (local !== url) content = content.split(url).join(local);
      }
      const firstPara = content.split("\n\n").find((b) => !b.startsWith("#") && !b.startsWith("!") && b.length > 60);

      // The index's card image first: it is the one picture chosen FOR this
      // article. og:image is the fallback, and on this site it is the logo.
      const fromIndex = coverBySlug.get(slug) || null;
      const cover = fromIndex || ogImage || firstImg || null;
      const coverIsBoilerplate = Boolean(dropCover && cover && cover.toLowerCase().includes(dropCover.toLowerCase()));

      posts.push({
        slug,
        title,
        content,
        excerpt: decode(desc).trim() || (firstPara ? firstPara.replace(/[*[\]]/g, "").slice(0, 180).trim() : ""),
        seoTitle: decode(rawTitle).trim() || title,
        seoDescription: decode(desc).trim() || "",
        // Every post on the source site used the logo as its og:image, which
        // would give a wall of identical cards. Better none than that.
        coverImageUrl: coverIsBoilerplate ? null : cover ? await localiseImage(cover) : null,
        sourceUrl: url,
      });
      console.log(`  ok   ${slug}  (${content.split(/\s+/).length} words)`);
    } catch (err) {
      console.error(`  FAIL ${slug} — ${err.message}`);
    }
  }

  const outPath = path.resolve(out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify({ source: indexUrl, scrapedAt: new Date().toISOString(), excluded: skipped, posts }, null, 2) + "\n",
  );
  console.log(`\n${posts.length}/${slugs.length} written to ${out}`);
  if (skipped.length) console.log(`excluded: ${skipped.join(", ")}`);
})();
