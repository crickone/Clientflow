// Run: npm test -- src/lib/notifications/model.test.ts
//
// The pure rules for staff notifications: who may see what, prefs, the lead
// source skip, the email 2-hour / known-sender rule, and the display helpers.
import assert from "node:assert/strict";

import {
  badgeText,
  classWhen,
  conversationHref,
  defaultPrefs,
  emailNotifies,
  emailThreadHref,
  eurText,
  kindsForRole,
  leadNotifies,
  leadSourceText,
  maySee,
  mergePrefs,
  messageTitle,
  pushRecipients,
  snippet,
  timeAgo,
} from "./model";

// Who sees what.
assert.deepEqual(kindsForRole("admin"), ["message", "lead", "sale", "booking"]);
assert.deepEqual(kindsForRole("staff"), ["message", "lead", "booking"], "sales are for admins only");
assert.equal(maySee("staff", { adminOnly: true }), false);
assert.equal(maySee("staff", { adminOnly: false }), true);
assert.equal(maySee("admin", { adminOnly: true }), true);

// Prefs: everything on by default; saved rows win; junk kinds are ignored.
const d = defaultPrefs();
assert.ok(Object.values(d).every((p) => p.inApp && p.push));
const merged = mergePrefs([
  { kind: "lead", inApp: false, push: true },
  { kind: "nonsense", inApp: false, push: false },
]);
assert.deepEqual(merged.lead, { inApp: false, push: true });
assert.deepEqual(merged.message, { inApp: true, push: true });
assert.equal("nonsense" in merged, false);

// Push recipients: role and the push switch both count.
const people = [
  { userId: 1, role: "admin" as const },
  { userId: 2, role: "staff" as const },
  { userId: 3, role: "staff" as const },
];
const prefs = new Map([[3, mergePrefs([{ kind: "message", inApp: true, push: false }])]]);
assert.deepEqual(pushRecipients(people, prefs, { kind: "sale", adminOnly: true }), [1], "a sale alerts admins only");
assert.deepEqual(pushRecipients(people, prefs, { kind: "message", adminOnly: false }), [1, 2], "push off for messages is respected");
assert.deepEqual(pushRecipients(people, prefs, { kind: "lead", adminOnly: false }), [1, 2, 3]);

// The lead source skip: a message already notified; staff's own leads are their own action.
assert.equal(leadNotifies("whatsapp"), false);
assert.equal(leadNotifies("messenger"), false);
assert.equal(leadNotifies("Instagram"), false);
assert.equal(leadNotifies("facebook"), true);
assert.equal(leadNotifies("website"), true);
assert.equal(leadNotifies(null), true);
assert.equal(leadNotifies("manual", "user"), false, "a lead a staff member typed in");
assert.equal(leadNotifies("email", "user"), false, "Add as lead from the inbox");
assert.equal(leadNotifies("manual", "agent"), false, "added by Adonis on approval");
assert.equal(leadSourceText("facebook"), "From Facebook lead form");
assert.equal(leadSourceText("zapier"), "From zapier");
assert.equal(leadSourceText(""), "New lead");

// Email: known sender, unread, and under 2 hours old.
const now = Date.UTC(2026, 10, 24, 12, 0, 0);
const H = 3600_000;
assert.equal(emailNotifies({ known: true, isRead: false, at: now - 10 * 60_000, now }), true);
assert.equal(emailNotifies({ known: false, isRead: false, at: now - 60_000, now }), false, "unknown sender");
assert.equal(emailNotifies({ known: true, isRead: true, at: now - 60_000, now }), false, "already read");
assert.equal(emailNotifies({ known: true, isRead: false, at: now - 2 * H, now }), false, "2 hours old is too old");
assert.equal(emailNotifies({ known: true, isRead: false, at: now - 2 * H + 1000, now }), true, "just under 2 hours");
assert.equal(emailNotifies({ known: true, isRead: false, at: now - 30 * 24 * H, now }), false, "a first sync of old mail is silent");
assert.equal(emailNotifies({ known: true, isRead: false, at: null, now }), false, "no date, no alert");
assert.equal(emailNotifies({ known: true, isRead: false, at: now + 60_000, now }), true, "a minute of clock skew is fine");

// Copy and links.
assert.equal(messageTitle("whatsapp", "Chris Walshe"), "WhatsApp from Chris Walshe");
assert.equal(messageTitle("instagram", "  "), "New Instagram message");
assert.equal(messageTitle("email", "ann@example.com"), "Email from ann@example.com");
assert.equal(eurText(6400), "EUR 64");
assert.equal(eurText(6450), "EUR 64.50");
assert.equal(conversationHref("client", 12), "/communication?open=conv%3Aclient-12");
assert.equal(emailThreadHref("18c<a@b>"), "/communication?open=email%3A18c%3Ca%40b%3E");
assert.equal(classWhen("Spin", "2026-11-25", "18:00"), "Spin, Wed 25 Nov at 18:00");

// Snippet: 140 characters at most, one line, cut on a word.
assert.equal(snippet("  hello\n\n there  "), "hello there");
const long = "word ".repeat(60);
const s = snippet(long);
assert.ok(s.length <= 140, `snippet is ${s.length} long`);
assert.ok(s.endsWith("…"));
assert.equal(snippet(null), "");

// Badge and times.
assert.equal(badgeText(0), null);
assert.equal(badgeText(7), "7");
assert.equal(badgeText(99), "99");
assert.equal(badgeText(100), "99+");
assert.equal(timeAgo(now - 20_000, now), "Just now");
assert.equal(timeAgo(now - 5 * 60_000, now), "5 min ago");
assert.equal(timeAgo(now - 3 * H, now), "3 h ago");
assert.equal(timeAgo(now - 30 * H, now), "Yesterday");

console.log("notifications model: all checks passed.");
