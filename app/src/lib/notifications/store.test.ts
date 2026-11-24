// Run: npm test -- src/lib/notifications/store.test.ts
//
// Staff notifications against a scratch business with two staff logins (one
// admin, one staff), alerts captured instead of sent (no network):
//   - the same key notifies once (dedupe);
//   - unread = after read_all_before and not read one by one; mark all clears
//     the per-item rows it covers;
//   - a sale is hidden from staff; a kind switched off in the app is hidden;
//   - alerts go to the right devices, respect the push switch, and a dead
//     device (410) is removed;
//   - notify never throws (no tenant, unknown tenant);
//   - the lead hook skips message sources and staff's own leads;
//   - email: known sender, unread, under 2 hours old.
// Nothing here makes an AI call: no webhook is driven with a real message.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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
        throw new Error("redirect() stub called in a test");
      },
      notFound: () => {
        throw new Error("notFound() stub called in a test");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);
globalThis.fetch = (async () => new Response("{}", { status: 500 })) as typeof fetch;

const tick = () => new Promise((r) => setTimeout(r, 20));

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant, getTenantDbById, closeTenantConn } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const schema = requireLocal("../db/schema") as typeof import("../db/schema");
  const store = requireLocal("./store") as typeof import("./store");
  const n = requireLocal("./notify") as typeof import("./notify");
  const { upsertLead } = requireLocal("../leads") as typeof import("../leads");

  const slug = "notifications-store-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  const scratchDir = path.join(process.cwd(), "data", "tenants", slug);
  fs.rmSync(scratchDir, { recursive: true, force: true });
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  controlSqlite.prepare("DELETE FROM users WHERE email LIKE ?").run(`%@${slug}.test`);
  const { id: tid } = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Notify Gym", dbFile) as { id: number };
  const addUser = (email: string, role: "admin" | "staff", active = 1) => {
    const { id } = controlSqlite
      .prepare("INSERT INTO users (email, name, password_hash, role, tenant_id) VALUES (?, ?, 'x', ?, ?) RETURNING id")
      .get(`${email}@${slug}.test`, email, role, tid) as { id: number };
    controlSqlite.prepare("INSERT INTO memberships (user_id, tenant_id, role, is_active) VALUES (?, ?, ?, ?)").run(id, tid, role, active);
    return id;
  };
  const admin = addUser("admin", "admin");
  const staff = addUser("staff", "staff");
  const gone = addUser("gone", "staff", 0);

  const sent: Array<{ endpoint: string; payload: { title: string; url: string } }> = [];
  n.setPushSenderForTests(async (sub, payload) => {
    if (sub.endpoint.includes("dead")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
  });

  try {
    getTenantDbById(tid);
    let checks = 0;
    const ok = (cond: unknown, msg: string) => {
      assert.ok(cond, msg);
      checks++;
    };

    await runWithTenant(tid, async () => {
      // Recipients: active staff of this business only.
      const staffIds = store.staffOf(tid).map((p) => p.userId).sort();
      ok(JSON.stringify(staffIds) === JSON.stringify([admin, staff].sort()), "an inactive membership gets nothing");
      ok(!staffIds.includes(gone), "the deactivated login is left out");

      // Someone seen for the first time starts with nothing unread.
      store.createNotification({ kind: "message", title: "Old", href: "/x", key: "k0", now: Date.now() - 120_000 });
      ok(store.unreadCount(admin, "admin") === 0, "a first-time user starts with no backlog");
      // From here on count everything (both people have caught up to time 0).
      store.markAllRead(admin, 0);
      store.markAllRead(staff, 0);
      ok(store.unreadCount(admin, "admin") === 1, "after that, older items count again for the test");
      store.markRead(admin, store.listForUser(admin, "admin")[0].id);
      store.markRead(staff, store.listForUser(staff, "staff")[0].id);

      // Notifications past 90 days are pruned when a new one arrives.
      const ancient = store.createNotification({ kind: "message", title: "Ancient", href: "/x", key: "k-old", now: Date.now() - 91 * 24 * 3600e3 });
      store.createNotification({ kind: "message", title: "Fresh", href: "/x", key: "k-fresh", now: Date.now() - 90_000 });
      ok(!store.listForUser(admin, "admin", 100).some((i) => i.id === ancient), "notifications older than 90 days are pruned");
      for (const [u, r] of [[admin, "admin"], [staff, "staff"]] as const) {
        const fresh = store.listForUser(u, r, 100).find((i) => i.title === "Fresh");
        if (fresh) store.markRead(u, fresh.id);
      }

      // Dedupe.
      const t0 = Date.now() - 60_000;
      const a = store.createNotification({ kind: "message", title: "A", href: "/x", key: "k1", now: t0 + 1 });
      const again = store.createNotification({ kind: "message", title: "A again", href: "/x", key: "k1", now: t0 + 2 });
      ok(a != null && again === null, "the same key notifies once");
      const b = store.createNotification({ kind: "lead", title: "B", href: "/x", key: "k2", now: t0 + 3 });
      const c = store.createNotification({ kind: "booking", title: "C", href: "/x", key: "k3", now: t0 + 5 });
      const sale = store.createNotification({ kind: "sale", title: "Sale", href: "/x", key: "k4", now: t0 + 6 });

      // Unread math and admin_only.
      ok(store.unreadCount(admin, "admin") === 4, "admin sees all 4");
      ok(store.unreadCount(staff, "staff") === 3, "staff do not see the sale");
      ok(!store.listForUser(staff, "staff").some((i) => i.id === sale), "the sale is not in a staff member's list");
      store.markRead(staff, b!);
      store.markRead(staff, b!); // twice is fine
      store.markRead(staff, 999_999); // unknown id is ignored
      ok(store.unreadCount(staff, "staff") === 2, "one read item drops the count by one");
      ok(store.unreadCount(admin, "admin") === 4, "reads are per person");
      ok(store.listForUser(staff, "staff").find((i) => i.id === b)?.unread === false, "the read one shows as read");
      store.markAllRead(staff, t0 + 4);
      ok(store.unreadCount(staff, "staff") === 1, "mark all up to t0+4 leaves only C");
      ok(store.listForUser(staff, "staff").find((i) => i.id === c)?.unread === true, "C is still unread");
      const leftover = getTenantDbById(tid).select().from(schema.notificationReads).all().filter((r) => r.userId === staff);
      ok(leftover.length === 0, "mark all clears the per-item rows it covers");
      ok(store.listForUser(admin, "admin")[0]?.id === sale, "newest first");

      // Prefs: in-app off hides the kind from the bell; defaults are all on.
      ok(Object.values(store.getPrefs(staff)).every((p) => p.inApp && p.push), "everything on by default");
      store.setPref(staff, "booking", { inApp: false, push: true });
      ok(store.getPrefs(staff).booking.inApp === false && store.getPrefs(staff).booking.push === true, "a pref is saved");
      ok(store.unreadCount(staff, "staff") === 0, "a kind off in the app is not counted");
      ok(!store.listForUser(staff, "staff").some((i) => i.kind === "booking"), "or listed");
      store.setPref(staff, "booking", { inApp: true, push: true });

      // Devices.
      store.savePushSubscription(admin, { endpoint: "https://push.test/admin", keys: { p256dh: "p".repeat(20), auth: "a".repeat(10) } }, "UA");
      store.savePushSubscription(staff, { endpoint: "https://push.test/staff", keys: { p256dh: "p".repeat(20), auth: "a".repeat(10) } }, "UA");
      store.savePushSubscription(staff, { endpoint: "https://push.test/staff-dead", keys: { p256dh: "p".repeat(20), auth: "a".repeat(10) } }, "UA");
      ok(store.pushDeviceCount(staff) === 2, "two devices for staff");
      store.savePushSubscription(staff, { endpoint: "https://push.test/staff", keys: { p256dh: "q".repeat(20), auth: "b".repeat(10) } }, "UA2");
      ok(store.pushDeviceCount(staff) === 2, "the same endpoint again updates, not duplicates");

      // notify(): a sale alerts the admin's device only.
      sent.length = 0;
      const saleId = n.notify({ kind: "sale", title: "Sale: Black Friday massage, EUR 64", body: "Ann Buyer", href: "/clients/1", key: "sale:offer:1" });
      await tick();
      ok(saleId != null, "notify returns the new id");
      ok(sent.length === 1 && sent[0].endpoint.endsWith("/admin"), "a sale alerts admins only");
      ok(sent[0].payload.url === "/clients/1", "the alert opens the item");
      ok(n.notify({ kind: "sale", title: "again", href: "/clients/1", key: "sale:offer:1" }) === null, "a repeat notifies nothing");

      // A message reaches both; the dead device is removed.
      sent.length = 0;
      n.notifyInboundMessage({ channel: "whatsapp", owner: "client", contactId: 7, name: "Chris Walshe", text: "Hi, can I book?", messageId: 1, providerMessageId: "wamid.1" });
      await tick();
      ok(sent.length === 2, `a message alerts admin and staff (got ${sent.length})`);
      ok(sent.some((s) => s.payload.title === "WhatsApp from Chris Walshe"), "title names the sender");
      ok(store.pushDeviceCount(staff) === 1, "the 410 device was removed");
      ok(n.notifyInboundMessage({ channel: "whatsapp", owner: "client", contactId: 7, name: "Chris Walshe", text: "Hi", messageId: 2, providerMessageId: "wamid.1" }) === null, "the same provider message notifies once");

      // Push switch off: no alert for that person, still in the bell.
      store.setPref(staff, "lead", { inApp: true, push: false });
      sent.length = 0;
      const leadNote = n.notify({ kind: "lead", title: "New lead: X", href: "/leads/1", key: "lead:test" });
      await tick();
      ok(sent.length === 1 && sent[0].endpoint.endsWith("/admin"), "push off is respected");
      ok(store.listForUser(staff, "staff").some((i) => i.id === leadNote), "but it is still in the bell");

      // The lead hook through upsertLead.
      const before = store.listForUser(admin, "admin", 100).length;
      upsertLead({ source: "whatsapp", phone: "+353870000001", notes: "Inbound WhatsApp" });
      upsertLead({ source: "manual", actor: "user", firstName: "Typed", lastName: "In" });
      upsertLead({ source: "offer", sourceLeadId: "offer:1", firstName: "Ann", lastName: "Buyer" });
      ok(store.listForUser(admin, "admin", 100).length === before, "message-source, staff-typed and buyer leads are silent");
      const { lead } = upsertLead({ source: "facebook", sourceLeadId: "fb-1", firstName: "Caroline", lastName: "Burke" });
      const top = store.listForUser(admin, "admin", 1)[0];
      ok(top?.title === "New lead: Caroline Burke" && top.body === "From Facebook lead form" && top.href === `/leads/${lead.id}`, "a Facebook lead notifies");
      upsertLead({ source: "facebook", sourceLeadId: "fb-1", firstName: "Caroline", lastName: "Burke" });
      ok(store.listForUser(admin, "admin", 100).filter((i) => i.title === "New lead: Caroline Burke").length === 1, "the same lead again is not new");
    });

    // Email: known client or lead, unread, under 2 hours old. Bound by tenant id.
    const now = Date.now();
    const email = (over: Partial<Parameters<typeof n.notifyInboundEmail>[1]>) =>
      n.notifyInboundEmail(tid, {
        messageKey: `m-${Math.random()}`,
        threadKey: "thread-1",
        fromEmail: "stranger@example.com",
        fromName: "Stranger",
        subject: "Hello",
        snippet: "Body",
        clientId: null,
        isRead: false,
        at: new Date(now - 60_000),
        ...over,
      }, now);
    ok(email({}) === null, "an unknown sender is silent");
    runWithTenant(tid, () => upsertLead({ source: "website", email: "Lead@Example.com", firstName: "Lea" }));
    const known = email({ fromEmail: "lead@example.com", fromName: "Lea" });
    ok(known != null, "a lead's email notifies (case-insensitive)");
    ok(email({ fromEmail: "lead@example.com", isRead: true }) === null, "a read email is silent");
    ok(email({ fromEmail: "lead@example.com", at: new Date(now - 3 * 3600_000) }) === null, "an old email (first sync) is silent");
    ok(email({ clientId: 1, fromEmail: "x@example.com" }) != null, "a client's email notifies");
    const em = runWithTenant(tid, () => store.listForUser(admin, "admin", 100).find((i) => i.id === known));
    ok(em?.title === "Email from Lea" && em.href === "/communication?open=email%3Athread-1" && em.body === "Hello: Body", "email copy and link");

    // Fail-soft: no tenant at all, and a tenant that does not exist.
    let threw = false;
    try {
      ok(n.notify({ kind: "message", title: "x", href: "/x", key: "nobody" }) === null, "no tenant: nothing, no throw");
      ok(runWithTenant(987_654_321, () => n.notify({ kind: "message", title: "x", href: "/x", key: "ghost" })) === null, "unknown tenant: nothing, no throw");
      ok(n.notifyInboundEmail(987_654_321, { messageKey: "z", threadKey: "z", fromEmail: "a@b.c", fromName: null, subject: null, snippet: null, clientId: 1, isRead: false, at: new Date() }) === null, "email to an unknown tenant: no throw");
    } catch {
      threw = true;
    }
    ok(!threw, "notify never throws into the caller");

    console.log(`notifications store: ${checks} checks passed.`);
  } finally {
    n.setPushSenderForTests(undefined);
    controlSqlite.prepare("DELETE FROM memberships WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM users WHERE email LIKE ?").run(`%@${slug}.test`);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    closeTenantConn(dbFile);
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
