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
// The list of selectors is READ OUT OF _style.css, never kept here. A gate
// whose scope is hand-maintained fails the same way the contract it is
// guarding does: someone adds a hiding rule, does not know this file exists,
// and the gate goes on passing while checking a shrinking fraction of the
// page. Deriving it means a new hiding rule is in scope the moment it is
// written, and a rule nothing reveals fails this run.
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "..", "app", "package.json"));
const { chromium } = require("playwright-core");

// The Playwright build on THIS machine, when it happens to be there. Pinning
// it outright -- build number, CPU architecture and all -- meant a Playwright
// bump or a run on anyone else's machine failed at launch with a path nobody
// could read as "install the browser". Playwright's own resolution is the
// fallback, and it is the one that is right everywhere.
const CHROME = join(
  process.env.HOME ?? "",
  "Library/Caches/ms-playwright/chromium_headless_shell-1243",
  "chrome-headless-shell-mac-arm64/chrome-headless-shell",
);

/* ---- the hiding rules, read from the stylesheet ------------------------
   Every pre-animation state in _style.css is one shape: `.js <selector>`
   parked at opacity 0, with the tail script expected to bring it back. So
   the rules can be read rather than restated -- one selector list, held in
   the file that actually decides it.

   Deliberately loud when it finds nothing. If the rules are ever reformatted
   past this pattern the honest outcome is a stopped run, not a green one:
   a gate quietly checking zero selectors reports "every element becomes
   visible" over a page where nothing does, which is worse than no gate at
   all because it is believed.
--------------------------------------------------------------------- */
const HIDING_RULE = /^\s*(\.js\s[^{]+)\{([^}]*)\}/gm;
function hidingSelectors(css) {
  const found = [];
  for (const [, selectors, body] of css.matchAll(HIDING_RULE)) {
    if (!/opacity\s*:\s*0\s*[;}]?/.test(body.replace(/opacity\s*:\s*0\.\d/g, ""))) continue;
    for (const one of selectors.split(",")) {
      // The `.js` prefix is the flag, not part of what is hidden: the browser
      // is told to find the elements, and the flag is on <html> in every page
      // this walks.
      const sel = one.trim().replace(/^\.js\s+/, "").trim();
      if (sel && !found.includes(sel)) found.push(sel);
    }
  }
  return found;
}

const selectors = hidingSelectors(readFileSync(join(here, "_style.css"), "utf8"));
if (!selectors.length) {
  console.error(
    "visible.mjs: no `.js <selector>{opacity:0}` rules found in _style.css. Either the\n" +
      "pre-animation states have moved or they are written in a shape this no longer\n" +
      "matches -- fix the derivation rather than letting the gate check nothing.",
  );
  process.exit(1);
}
const HIDDEN = selectors.join(", ");
console.log(`from _style.css: ${selectors.length} hiding rule(s) -- ${HIDDEN}`);

// The longest reveal on the site is an eighteen-row stagger: 0.07s apart plus
// a 0.85s tween is a shade over two seconds, so settle well past that. A short
// wait reports the tail of a long list as invisible and cries wolf.
const SETTLE = 4000;

const pages = readdirSync(here).filter((f) => f.endsWith(".html")).sort();
const browser = await chromium.launch(existsSync(CHROME) ? { executablePath: CHROME } : {});
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
