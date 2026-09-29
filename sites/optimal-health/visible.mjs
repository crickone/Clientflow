#!/usr/bin/env node
// Nothing the stylesheet hides may still be hidden once the page has been read.
//
//   node visible.mjs
//
// This site animates content in: the stylesheet parks a set of selectors at
// opacity 0 while the `js` flag is on, and the tail script is expected to bring
// each one back. That is a contract between two files that never reference each
// other, and it has been broken three separate times:
//
//   - three home-page links, hidden by [data-rise] and revealed by nothing,
//     invisible from the day the site was built;
//   - two therapies headings, after the reveal was widened to [data-rise] and
//     stopped matching the .band__head .title the CSS also hides;
//   - contact and pricing headlines, painted plaster on plaster.
//
// None of it was visible to a screenshot, because a missing heading looks like
// a design choice. So this walks every built page, waits for the animations to
// settle, and fails if anything the stylesheet hides is still at opacity 0.
//
// Add a selector here whenever you add one to the hiding rules in _style.css.
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
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

// Every selector _style.css parks at opacity 0 behind the `js` flag.
const HIDDEN = "[data-rise], [data-stagger] > *, .roll__row, .band__head .title";

// The longest reveal on the site is an eighteen-row stagger: 0.07s apart plus
// a 0.85s tween is a shade over two seconds, so settle well past that. A short
// wait reports the tail of a long list as invisible and cries wolf.
const SETTLE = 4000;

const pages = readdirSync(here).filter((f) => f.endsWith(".html")).sort();
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

let checked = 0;
let hiddenCount = 0;

for (const file of pages) {
  await page.goto(`file://${join(here, file)}`, { waitUntil: "networkidle" });
  // Walk the page: these reveals are ScrollTrigger-driven and never fire otherwise.
  await page.evaluate(async () => {
    await new Promise((res) => {
      let y = 0;
      const step = () => {
        y += 400;
        window.scrollTo(0, y);
        if (y < document.body.scrollHeight) setTimeout(step, 90);
        else res();
      };
      step();
    });
  });
  await page.waitForTimeout(SETTLE);

  const { total, stuck } = await page.evaluate((sel) => {
    const all = [...document.querySelectorAll(sel)];
    return {
      total: all.length,
      stuck: all
        .filter((el) => parseFloat(getComputedStyle(el).opacity) < 0.05)
        .map((el) => {
          const cls = (el.className || "").toString().split(" ")[0];
          const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 48);
          return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""} "${text}"`;
        }),
    };
  }, HIDDEN);

  checked += total;
  if (stuck.length) {
    hiddenCount += stuck.length;
    console.error(`  ${file}: ${stuck.length} never became visible`);
    stuck.forEach((s) => console.error(`     ${s}`));
  }
}

await browser.close();

if (hiddenCount) {
  console.error(`\n${hiddenCount} element(s) the stylesheet hides are never revealed.`);
  process.exit(1);
}
console.log(`${checked} animated elements across ${pages.length} pages: every one becomes visible.`);
