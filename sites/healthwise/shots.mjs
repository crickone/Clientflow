#!/usr/bin/env node
// Screenshot every built page at desktop and phone width and LOOK at them.
// Designing against your own markup does not work; the picture catches what
// reasoning does not (a wrapping wordmark, an image cropping a face, a form
// field too narrow for a phone number).
//
//   node shots.mjs                      all pages, file:// URLs
//   node shots.mjs http://localhost:3000/site/healthwise   after import
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

const CHROME = join(process.env.HOME, "Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const base = process.argv[2] || null;
const out = join(here, "_shots");
mkdirSync(out, { recursive: true });

const pages = readdirSync(here).filter((f) => f.endsWith(".html")).map((f) => f.replace(/\.html$/, ""));
const b = await chromium.launch({ executablePath: CHROME });
for (const width of [1440, 390]) {
  const p = await b.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  for (const name of pages) {
    const url = base
      ? `${base.replace(/\/$/, "")}${name === "index" ? "" : "/" + name}`
      : `file://${join(here, name + ".html")}`;
    await p.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    // Walk the page so every scroll-triggered reveal has fired before the capture.
    await p.evaluate(async () => {
      await new Promise((res) => {
        let y = 0;
        const step = () => { y += 500; window.scrollTo(0, y); if (y < document.body.scrollHeight) setTimeout(step, 120); else res(); };
        step();
      });
    });
    await p.waitForTimeout(900);
    await p.evaluate(() => window.scrollTo(0, 0));
    const file = join(out, `${name}-${width}.png`);
    await p.screenshot({ path: file, fullPage: true });
    console.log("wrote", file);
  }
  await p.close();
}
await b.close();
