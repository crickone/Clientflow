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

const pages = readdirSync(here).filter((f) => f.endsWith(".html")).sort();
const browser = await chromium.launch({ executablePath: CHROME });

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
    await page.screenshot({ path: join(out, `${f.replace(/\.html$/, "")}-${label}.png`), fullPage: true });
    console.log(`  ${label.padEnd(8)} ${f}`);
  }
  await ctx.close();
}
await browser.close();
console.log(`\n${pages.length * 2} screenshots in ${out}`);
