// Dev-only UI verification. Seeds a THROWAWAY admin + session into the local
// clinic.db (never touches the real account), optionally flips venue_type to
// preview the gym vocabulary, drives installed Chrome via playwright-core to
// screenshot gated pages, then restores everything.
import Database from "better-sqlite3";
import crypto from "node:crypto";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = "http://localhost:3000";
const DB_PATH = path.join(process.cwd(), "data", "clinic.db");
const EMAIL = "__preview_verify@local";
const TOKEN = crypto.randomBytes(32).toString("hex");
const OUT = process.cwd().replace(/app$/, "");
// venue type to preview: pass "gym" or "clinic" as argv[2] (default clinic)
const VENUE = process.argv[2] === "gym" ? "gym" : "clinic";

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

function setVenue(v) {
  db.prepare(
    "INSERT INTO settings (key,value) VALUES ('venue_type', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify(v));
}

function cleanup() {
  try {
    const u = db.prepare("SELECT id FROM users WHERE email = ?").get(EMAIL);
    if (u) {
      db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(u.id);
      db.prepare("DELETE FROM users WHERE id = ?").run(u.id);
    }
    setVenue("clinic"); // always restore clinic default
  } catch (e) {
    console.error("cleanup failed:", e.message);
  }
}

let browser;
try {
  cleanup();
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync("x", Buffer.from(salt, "hex"), 64).toString("hex");
  const info = db
    .prepare(
      "INSERT INTO users (email, name, password_hash, role, must_change_password, is_active) VALUES (?, ?, ?, 'admin', 0, 1)",
    )
    .run(EMAIL, "Preview", `scrypt$${salt}$${hash}`);
  const userId = Number(info.lastInsertRowid);
  db.prepare(
    "INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
  ).run(TOKEN, userId, Date.now() + 86_400_000);
  setVenue(VENUE);
  console.log("seeded throwaway admin id", userId, "venue_type:", VENUE);

  browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
  });
  await ctx.addCookies([
    { name: "clientflow_session", value: TOKEN, url: BASE, httpOnly: true, sameSite: "Lax" },
  ]);
  const page = await ctx.newPage();

  for (const [route, file] of [
    ["/reports", `verify-${VENUE}-reports.png`],
    ["/appointments/new", `verify-${VENUE}-booking.png`],
    ["/packages/new", `verify-${VENUE}-sellplan.png`],
    ["/leads", `verify-${VENUE}-leads.png`],
  ]) {
    await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(1500);
    const out = path.join(OUT, file);
    await page.screenshot({ path: out, fullPage: false });
    console.log("captured", route, "->", out, "url:", page.url());
  }

  await browser.close();
} catch (e) {
  console.error("ERROR:", e.message);
  if (browser) await browser.close().catch(() => {});
} finally {
  cleanup();
  db.close();
  console.log("restored clinic default + removed throwaway admin");
}
