// Screenshot a URL or a local file with the Playwright Chromium that is
// already on this machine. Written while rebuilding the Optimal Health site:
// designing against a reference you have only read the markup of does not
// work, and looking at your own output catches things reasoning does not
// (an overflowing wordmark, type landing on signage in the photo, a footer
// clipped off the page).
//
//   CHROME="$HOME/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell" \
//     node tools/screenshot.mjs <url> <out.png> [full]
//
// Run it from app/ so playwright-core resolves from app/node_modules.
import { chromium } from "playwright-core";
const [url, out, mode] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.CHROME });
const p = await b.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await p.goto(url, { waitUntil: "load", timeout: 90000 }).catch(() => {});
// walk the page so lazy images and scroll-triggered reveals fire
await p.evaluate(async () => {
  await new Promise((res) => {
    let y = 0;
    const step = () => {
      y += window.innerHeight * 0.6;
      window.scrollTo(0, y);
      if (y < document.body.scrollHeight) setTimeout(step, 220); else res();
    };
    step();
  });
});
await p.waitForTimeout(2000);
await p.evaluate(() => window.scrollTo(0, 0));
await p.waitForTimeout(1200);
await p.screenshot({ path: out, fullPage: mode === "full" });
await b.close();
console.log("wrote", out);
