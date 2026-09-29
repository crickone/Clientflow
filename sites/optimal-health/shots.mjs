#!/usr/bin/env node
// Screenshot every built page at desktop and phone width and LOOK at them.
// Designing against your own markup does not work; the picture catches what
// reasoning does not (a wrapping wordmark, a rail colliding with body copy,
// a chapter strip that scrolls off its own labels).
//
//   node shots.mjs                       all pages, file:// URLs
//   node shots.mjs http://localhost:4321 against a running server
//
// playwright-core is resolved from app/node_modules; the browser is the
// Playwright Chromium already on this machine.
import { createRequire } from "node:module";
import { mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "..", "app", "package.json"));
const { chromium } = require("playwright-core");

const CHROME = join(
  process.env.HOME,
  "Library/Caches/ms-playwright/chromium_headless_shell-1243",
  "chrome-headless-shell-mac-arm64/chrome-headless-shell",
);
const base = process.argv[2] || null;
const out = join(here, "_shots");
mkdirSync(out, { recursive: true });

// Find horizontal overflow and name what causes it. A fullPage screenshot
// clips to the viewport's *width* even though it walks the full scroll
// height, so anything sticking out to the right is silently cropped out of
// the picture -- the header row overflowing at 390px sat unseen through
// every earlier pass of this harness for exactly that reason. This runs
// in-page, at whatever text size the browser actually has (default): it is
// not the tool for the site's separate, already-known 150%-text-zoom
// overflow in .lede/.body/the wordmark, and must not be tuned to hide that
// case if it somehow shows up here too.
async function findOverflow(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const docWidth = document.documentElement.scrollWidth;
    const overflowPx = docWidth - vw;
    if (overflowPx <= 1) return { overflowPx: 0, docWidth, vw, culprits: [] };

    // Every element whose right edge clears the viewport is "overflowing",
    // but that includes <html> and <body> and every ancestor of the one
    // element actually too wide -- reporting all of them just says "the
    // page overflows" in a hundred different voices. Keep only elements
    // that stick out further than their own parent: the first link in each
    // chain where the overflow actually originates.
    const offenders = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      const amount = r.right - vw;
      if (amount <= 1) continue;
      const parent = el.parentElement;
      const parentAmount = parent ? parent.getBoundingClientRect().right - vw : -Infinity;
      if (amount > parentAmount + 0.5) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || "",
          cls: typeof el.className === "string" ? el.className.trim() : "",
          amount: Math.round(amount),
          right: Math.round(r.right),
        });
      }
    }
    offenders.sort((a, b) => b.amount - a.amount);
    return { overflowPx: Math.round(overflowPx), docWidth, vw, culprits: offenders.slice(0, 5) };
  });
}

function describeOffender(o) {
  const id = o.id ? `#${o.id}` : "";
  const cls = o.cls ? `.${o.cls.split(/\s+/).join(".")}` : "";
  return `${o.tag}${id}${cls}`;
}

const pages = readdirSync(here).filter((f) => f.endsWith(".html")).sort();
const browser = await chromium.launch({ executablePath: CHROME });
let overflowCount = 0;

for (const [label, width, height] of [["desktop", 1440, 900], ["phone", 390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  for (const f of pages) {
    const url = base ? `${base}/${f}` : `file://${join(here, f)}`;
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    // Walk the page so every scroll-triggered reveal has fired before the
    // capture. Without this, everything below the fold is still at opacity 0
    // -- fullPage does not scroll, so GSAP never fires and the screenshot is
    // a column of empty colour blocks that looks like a broken page.
    await page.evaluate(async () => {
      await new Promise((res) => {
        let y = 0;
        const step = () => {
          y += 500;
          window.scrollTo(0, y);
          if (y < document.body.scrollHeight) setTimeout(step, 120);
          else res();
        };
        step();
      });
    });
    await page.waitForTimeout(900);
    await page.evaluate(() => window.scrollTo(0, 0));

    // Measure and report before capturing, never in place of it: the point
    // is that the number and the picture arrive together, not that a bad
    // number stops the picture from being taken.
    const overflow = await findOverflow(page);
    if (overflow.overflowPx > 0) {
      overflowCount++;
      console.log(
        `  ${label.padEnd(8)} ${f}  !! OVERFLOW: scrollWidth ${overflow.docWidth}px > viewport ${overflow.vw}px (+${overflow.overflowPx}px)`,
      );
      for (const o of overflow.culprits) {
        console.log(`             -> ${describeOffender(o)}  right edge +${o.amount}px past the viewport`);
      }
    } else {
      console.log(`  ${label.padEnd(8)} ${f}  ok, no horizontal overflow (scrollWidth ${overflow.docWidth}px = viewport ${overflow.vw}px)`);
    }

    await page.screenshot({ path: join(out, `${f.replace(/\.html$/, "")}-${label}.png`), fullPage: true });
  }
  await ctx.close();
}
await browser.close();
console.log(`\n${pages.length * 2} screenshots in ${out}`);
if (overflowCount > 0) {
  console.log(`!! ${overflowCount} page/width combination(s) overflow horizontally -- see OVERFLOW lines above. This does not fail the run; the screenshots were still taken.`);
} else {
  console.log("No horizontal overflow found at any page or width.");
}
