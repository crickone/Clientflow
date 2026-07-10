// Dev-only UI verification for the /communication inbox. Seeds a THROWAWAY
// admin + session (never touches the real account), screenshots the EMPTY
// state, then inserts a couple of TEMPORARY messages (one inbound lead, one
// outbound client) to screenshot the POPULATED state, and finally removes
// everything it created. Requires the dev server on :3000.
import Database from "better-sqlite3";
import crypto from "node:crypto";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = "http://localhost:3000";
const DB_PATH = path.join(process.cwd(), "data", "clinic.db");
const EMAIL = "__preview_verify@local";
const TOKEN = crypto.randomBytes(32).toString("hex");
const OUT = process.cwd().replace(/app$/, "");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const inserted = { leadMsg: [], clientMsg: [] };

function cleanup() {
  try {
    for (const id of inserted.leadMsg)
      db.prepare("DELETE FROM lead_messages WHERE id = ?").run(id);
    for (const id of inserted.clientMsg)
      db.prepare("DELETE FROM client_messages WHERE id = ?").run(id);
    const u = db.prepare("SELECT id FROM users WHERE email = ?").get(EMAIL);
    if (u) {
      db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(u.id);
      db.prepare("DELETE FROM users WHERE id = ?").run(u.id);
    }
  } catch (e) {
    console.error("cleanup failed:", e.message);
  }
}

let browser;
try {
  cleanup();

  // Throwaway admin + session.
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
  console.log("seeded throwaway admin id", userId);

  browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
  });
  await ctx.addCookies([
    { name: "clientflow_session", value: TOKEN, url: BASE, httpOnly: true, sameSite: "Lax" },
  ]);
  const page = await ctx.newPage();

  async function shot(file) {
    await page.goto(BASE + "/communication", { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(1200);
    const out = path.join(OUT, file);
    await page.screenshot({ path: out, fullPage: false });
    console.log("captured /communication ->", out, "url:", page.url());
  }

  // 1) Empty state.
  await shot("verify-communication-empty.png");

  // 2) Populated: insert a temp exchange on the existing lead (newest -> it
  //    auto-selects, so the right pane shows a real back-and-forth) plus one
  //    client message so both kinds appear in the list.
  const lead = db.prepare("SELECT id FROM leads ORDER BY id LIMIT 1").get();
  const client = db.prepare("SELECT id FROM clients ORDER BY id LIMIT 1").get();
  const now = Date.now();
  const leadMsg = db.prepare(
    "INSERT INTO lead_messages (lead_id, direction, channel, content, status, created_at) VALUES (?, ?, 'whatsapp', ?, ?, ?)",
  );
  if (lead) {
    for (const [dir, body, status, ago] of [
      ["inbound", "Hi! Is the HBOT chamber available this Saturday morning?", null, 12 * 60_000],
      ["outbound", "Hi Aoife — yes, we have a 9:30 and an 11:00 slot free on Saturday. Which suits?", "delivered", 9 * 60_000],
      ["inbound", "11:00 is perfect, thanks. Do I need to do anything to prepare?", null, 1 * 60_000],
    ]) {
      const r = leadMsg.run(lead.id, dir, body, status, now - ago);
      inserted.leadMsg.push(Number(r.lastInsertRowid));
    }
  }
  if (client) {
    const r = db
      .prepare(
        "INSERT INTO client_messages (client_id, direction, channel, content, status, created_at) VALUES (?, 'outbound', 'whatsapp', ?, 'delivered', ?)",
      )
      .run(client.id, "Your session is confirmed for tomorrow at 10:00. See you then!", now - 5 * 60_000);
    inserted.clientMsg.push(Number(r.lastInsertRowid));
  }
  console.log("seeded temp messages:", inserted);

  await shot("verify-communication-populated.png");

  await browser.close();
} catch (e) {
  console.error("ERROR:", e.message);
  if (browser) await browser.close().catch(() => {});
} finally {
  cleanup();
  db.close();
  console.log("cleaned up temp messages + throwaway admin");
}
