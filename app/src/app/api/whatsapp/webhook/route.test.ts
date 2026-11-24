// Run: npm test -- src/app/api/whatsapp/webhook/route.test.ts
//
// Regression (2026-11-24): the WhatsApp token has been stored sealed
// (tokenEnc) since 2026-10-22, but the webhook still looked for a plain
// `token` in the raw settings row, found none, and refused every incoming
// message with 401. Here the config is saved the real way (setWhatsAppConfig,
// so sealed) on a scratch tenant, and the real POST export must accept the
// right header secret and refuse a wrong one. The body carries no message, so
// nothing is threaded and no AI triage runs.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in whatsapp webhook route.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../../../../lib/db/control") as typeof import("@/lib/db/control");
  const { runWithTenant } = requireLocal("../../../../lib/db/tenant") as typeof import("@/lib/db/tenant");
  const { readKeyForTenant } = requireLocal("../../../../lib/settings") as typeof import("@/lib/settings");
  const { setWhatsAppConfig } = requireLocal("../../../../lib/whatsapp/config") as typeof import("@/lib/whatsapp/config");
  const { POST } = requireLocal("./route") as typeof import("./route");

  const slug = "whatsapp-route-test";
  const SECRET = "route-test-secret-0123456789";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const { id: tid } = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "WhatsApp Route Test", `tenants/${slug}/${slug}.db`) as { id: number };

  const post = (secret: string | null) =>
    POST(
      new Request(`http://localhost/api/whatsapp/webhook?t=${slug}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(secret ? { "x-webhook-secret": secret } : {}) },
        body: JSON.stringify({ event: { type: "statuses", event: "post" }, statuses: [] }),
      }) as never,
    );

  try {
    await runWithTenant(tid, async () => {
      setWhatsAppConfig({ provider: "whapi", token: "whapi-test-token", channel: "", baseUrl: "", webhookSecret: SECRET, webhookHeaderMode: true });
    });
    const raw = readKeyForTenant<Record<string, unknown>>(tid, "whatsapp_config", {});
    assert.ok(raw.tokenEnc && !raw.token, "the token is stored sealed, as in production");

    assert.equal((await post(SECRET)).status, 200, "the right header secret is accepted");
    assert.equal((await post("wrong-secret")).status, 401, "a wrong secret is refused");
    assert.equal((await post(null)).status, 401, "no secret is refused");
    console.log("whatsapp webhook route: 4 checks passed.");
  } finally {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
