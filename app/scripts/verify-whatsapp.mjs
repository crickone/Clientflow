// Dev-only: verify the WhatsApp webhook (secret check, inbound threading, status
// update) with SIMULATED provider payloads — no live Whapi needed. Sets a temp
// config, exercises the route, cleans up.
import Database from "better-sqlite3";

const BASE = "http://localhost:3000";
const SECRET = "testsecret_" + Math.random().toString(36).slice(2, 8);
const PHONE = "353999000111"; // unknown number → should park a whatsapp lead
const WAMID = "wamid-verify-" + Math.random().toString(36).slice(2, 8);

const db = new Database("data/clinic.db");
db.pragma("journal_mode = WAL");

const hadConfig = db
  .prepare("SELECT value FROM settings WHERE key='whatsapp_config'")
  .get();

function setConfig() {
  const cfg = {
    provider: "whapi",
    token: "test-token",
    channel: "",
    baseUrl: "https://gate.whapi.cloud",
    webhookSecret: SECRET,
  };
  db.prepare(
    "INSERT INTO settings (key,value) VALUES ('whatsapp_config', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(JSON.stringify(cfg));
}

async function post(secret, body) {
  const qs = secret == null ? "" : `?secret=${encodeURIComponent(secret)}`;
  const res = await fetch(`${BASE}/api/whatsapp/webhook${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.status;
}

let parkedLeadId = null;
try {
  setConfig();

  // 1. Secret rejection
  const noSecret = await post(null, { messages: [] });
  const wrongSecret = await post("nope", { messages: [] });
  console.log("no-secret →", noSecret, "(expect 401)");
  console.log("wrong-secret →", wrongSecret, "(expect 401)");

  // 2. Inbound from an unknown number → parks a whatsapp lead + inbound msg
  const inboundStatus = await post(SECRET, {
    messages: [
      {
        id: "wamid-inbound-1",
        from: `${PHONE}@s.whatsapp.net`,
        type: "text",
        from_me: false,
        timestamp: Math.floor(Date.now() / 1000),
        text: { body: "Hi, is HBOT available Saturday?" },
      },
    ],
  });
  const lead = db
    .prepare(
      "SELECT id, source FROM leads WHERE phone=? ORDER BY id DESC LIMIT 1",
    )
    .get(PHONE);
  parkedLeadId = lead?.id ?? null;
  const inboundMsg = parkedLeadId
    ? db
        .prepare(
          "SELECT direction, channel, content FROM lead_messages WHERE lead_id=? AND direction='inbound'",
        )
        .get(parkedLeadId)
    : null;
  console.log("inbound →", inboundStatus, "(expect 200)");
  console.log(
    "  parked lead:",
    lead ? `#${lead.id} source=${lead.source}` : "(none!)",
    "| inbound msg:",
    inboundMsg ? `${inboundMsg.channel}: "${inboundMsg.content}"` : "(none!)",
  );

  // 3. Status update → flips a known outbound row's status
  if (parkedLeadId) {
    db.prepare(
      "INSERT INTO lead_messages (lead_id,direction,channel,content,provider_message_id,status) VALUES (?,?,?,?,?,?)",
    ).run(parkedLeadId, "outbound", "whatsapp", "test outbound", WAMID, "sent");
    const statusCode = await post(SECRET, {
      statuses: [{ id: WAMID, status: "delivered", recipient_id: PHONE }],
    });
    const row = db
      .prepare("SELECT status FROM lead_messages WHERE provider_message_id=?")
      .get(WAMID);
    console.log("status →", statusCode, "(expect 200)");
    console.log("  outbound status now:", row?.status, "(expect delivered)");
  }
} catch (e) {
  console.error("ERROR:", e.message);
} finally {
  if (parkedLeadId) {
    db.prepare("DELETE FROM lead_messages WHERE lead_id=?").run(parkedLeadId);
    db.prepare("DELETE FROM leads WHERE id=?").run(parkedLeadId);
  }
  if (hadConfig) {
    db.prepare("UPDATE settings SET value=? WHERE key='whatsapp_config'").run(
      hadConfig.value,
    );
  } else {
    db.prepare("DELETE FROM settings WHERE key='whatsapp_config'").run();
  }
  db.close();
  console.log("[cleaned up parked lead + temp config]");
}
