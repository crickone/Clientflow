// Run: npm test -- src/lib/mailgunRoute.test.ts
//
// A business whose mailbox receives over IMAP but whose SMTP server our host
// can't reach sends one-to-one email through its verified Mailgun domain:
// from <mailbox name>@<domain>, Reply-To the real mailbox, no tracking, and
// the send is recorded as an outbound email in the inbox. Fetch is mocked:
// nothing leaves the machine.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") return { redirect: () => { throw new Error("redirect stub"); } };
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("./db/control") as typeof import("@/lib/db/control");
  const { runWithTenant, getTenantDbById } = requireLocal("./db/tenant") as typeof import("@/lib/db/tenant");
  const schema = requireLocal("./db/schema") as typeof import("@/lib/db/schema");
  const { saveImapConnection, deleteImapConnection } = requireLocal("./imapEmail") as typeof import("@/lib/imapEmail");
  const { setMailgunRoute, mailgunRouteDomain } = requireLocal("./mailgunRoute") as typeof import("@/lib/mailgunRoute");
  const { sendEmailForTenant } = requireLocal("./email") as typeof import("@/lib/email");

  const slug = "mailgun-route-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const { id: tid } = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Mailgun Route Test", `tenants/${slug}/${slug}.db`) as { id: number };

  const prevKey = process.env.MAILGUN_API_KEY;
  const prevRegion = process.env.MAILGUN_REGION;
  process.env.MAILGUN_API_KEY = "key-test";
  process.env.MAILGUN_REGION = "eu";
  const realFetch = globalThis.fetch;
  const calls: { url: string; form: URLSearchParams }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), form: new URLSearchParams(String(init?.body ?? "")) });
    return new Response(JSON.stringify({ id: "<20261124.1@mg.route-test.ie>", message: "Queued" }), { status: 200 });
  }) as typeof fetch;

  try {
    saveImapConnection({
      tenantId: tid, email: "info@route-test.ie", imapHost: "imap.example.test", imapPort: 993, imapSecure: true,
      smtpHost: "smtp.example.test", smtpPort: 465, smtpSecure: true, username: "info@route-test.ie", password: "pw",
    });
    getTenantDbById(tid).insert(schema.sendingDomains).values({ domain: "mg.route-test.ie", state: "verified", verifiedAt: new Date() }).run();

    await runWithTenant(tid, async () => {
      assert.equal(mailgunRouteDomain(tid), null, "off until switched on");
      setMailgunRoute(true);
      assert.equal(mailgunRouteDomain(tid), "mg.route-test.ie", "on with a verified domain");

      const res = await sendEmailForTenant(tid, { to: "buyer@example.com", subject: "Your Black Friday offer", html: "<p>Thanks for buying.</p>" });
      assert.ok(res.ok, `sent: ${JSON.stringify(res)}`);
      assert.equal(calls.length, 1, "one Mailgun call");
      const { url, form } = calls[0];
      assert.equal(url, "https://api.eu.mailgun.net/v3/mg.route-test.ie/messages", "sent through the verified domain");
      assert.match(form.get("from") ?? "", /<info@mg\.route-test\.ie>$/, "from the mailbox name on the domain");
      assert.equal(form.get("h:Reply-To"), "info@route-test.ie", "replies go to the real mailbox");
      assert.equal(form.get("o:tracking"), "no", "no tracking on one-to-one mail");
      assert.equal(form.get("to"), "buyer@example.com");
      const sent = getTenantDbById(tid).select().from(schema.emailMessages).all().filter((m) => m.direction === "out");
      assert.equal(sent.length, 1, "recorded in the inbox as sent");

      setMailgunRoute(false);
      assert.equal(mailgunRouteDomain(tid), null, "off again when SMTP works");
    });
    console.log("mailgunRoute: 11 checks passed.");
  } finally {
    globalThis.fetch = realFetch;
    if (prevKey === undefined) delete process.env.MAILGUN_API_KEY; else process.env.MAILGUN_API_KEY = prevKey;
    if (prevRegion === undefined) delete process.env.MAILGUN_REGION; else process.env.MAILGUN_REGION = prevRegion;
    deleteImapConnection(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
