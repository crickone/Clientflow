#!/usr/bin/env node
/**
 * Screenshots of every console page, for looking at a change before it ships.
 *
 *   ADMIN_SESSION=<raw token> node scripts/screens.mjs <outDir> [page…]
 *
 * Needs the main app on :3000 and the console on :3100. To mint a local
 * session for user 1 in the DEV control database (never production):
 *
 *   RAW=$(openssl rand -hex 24); KEY="h1:$(printf %s "$RAW" | shasum -a 256 | cut -d' ' -f1)"
 *   sqlite3 ../app/data/control.db "insert into platform_sessions(token,user_id,expires_at) values('$KEY',1,$(( ($(date +%s)+86400)*1000 )))"
 *   ADMIN_SESSION=$RAW node scripts/screens.mjs /tmp/screens
 *
 * Delete the row afterwards: sqlite3 ../app/data/control.db "delete from platform_sessions where token='$KEY'"
 */
import fs from "node:fs";
import { chromium } from "../../app/node_modules/playwright-core/index.mjs";

const [out, ...only] = process.argv.slice(2);
if (!out || !process.env.ADMIN_SESSION) {
  console.error("usage: ADMIN_SESSION=<raw token> node scripts/screens.mjs <outDir> [page…]");
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });

const cacheDir = `${process.env.HOME}/Library/Caches/ms-playwright`;
const shell = fs.readdirSync(cacheDir).find((d) => d.startsWith("chromium_headless_shell"));
const exe = shell ? `${cacheDir}/${shell}/chrome-headless-shell-mac-arm64/chrome-headless-shell` : undefined;

const TENANT = process.env.TENANT_ID ?? "1028";
const pages = {
  dash: "/", gyms: "/gyms", gym: `/gyms/${TENANT}`, people: `/gyms/${TENANT}/people`,
  integ: `/gyms/${TENANT}/integrations`, money: `/gyms/${TENANT}/money`, features: `/gyms/${TENANT}/features`,
  data: `/gyms/${TENANT}/data`, thealth: `/gyms/${TENANT}/health`, timeline: `/gyms/${TENANT}/timeline`,
  provision: "/provision", staff: "/staff", audit: "/audit", health: "/health", settings: "/settings",
};

const browser = await chromium.launch({ executablePath: fs.existsSync(exe ?? "") ? exe : undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "cf_admin_session", value: process.env.ADMIN_SESSION, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
for (const [name, url] of Object.entries(pages)) {
  if (only.length && !only.includes(name)) continue;
  await page.goto(`http://localhost:3100${url}`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  console.log(name, page.url());
}
await browser.close();
