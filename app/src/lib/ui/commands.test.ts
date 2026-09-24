// Run: npm test -- src/lib/ui/commands.test.ts
//
// The gates matter more than the ranking here. A palette that offers a page
// the sidebar has hidden sends someone to a route the layout redirects away
// from — which reads as the app being broken, not as a permission working.
import assert from "node:assert/strict";

import { buildCommands, filterCommands, scoreCommand, type NavEntryLike } from "./commands";
import { isTyping, resolveAppShortcut } from "./shortcuts";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  passed++;
}

const NAV: NavEntryLike[] = [
  { href: "/dashboard", label: "Dashboard" },
  {
    label: "Clients",
    children: [
      { href: "/clients", label: "Clients", labelKey: "members" },
      { href: "/leads", label: "Leads" },
      { href: "/appointments", label: "Appointments", mode: "appointments" },
      { href: "/timetable", label: "Timetable", mode: "timetable" },
    ],
  },
  {
    label: "Marketing",
    children: [
      { href: "/marketing/campaigns", label: "Campaigns" },
      { href: "/content-studio", label: "Content Studio" },
      { label: "Email", children: [{ href: "/campaigns/contacts", label: "Contacts" }] },
    ],
  },
  { label: "System", adminOnly: true, children: [{ href: "/settings", label: "Settings" }] },
  { href: "/renova-only", label: "Legacy import", tenants: ["renova"] },
];

const base = { isAdmin: true, mode: "appointments" as const, tenantSlug: "inspire" };

// ─────────────────────────────────────────────────────────── gates
{
  const all = buildCommands(NAV, base);
  check("flattens nested groups", all.some((c) => c.href === "/campaigns/contacts"), true);
  check("nested group trail is kept", all.find((c) => c.href === "/campaigns/contacts")?.group, "Marketing › Email");
  check("top-level link has no group", all.find((c) => c.href === "/dashboard")?.group, "");

  check("appointments mode hides the timetable", all.some((c) => c.href === "/timetable"), false);
  check("appointments mode keeps appointments", all.some((c) => c.href === "/appointments"), true);
  check("another tenant's module is hidden", all.some((c) => c.href === "/renova-only"), false);
}
{
  const gym = buildCommands(NAV, { ...base, mode: "timetable" });
  check("timetable mode flips the pair", [gym.some((c) => c.href === "/timetable"), gym.some((c) => c.href === "/appointments")], [true, false]);
}
{
  const staff = buildCommands(NAV, { ...base, isAdmin: false });
  check("an admin-only GROUP hides its children", staff.some((c) => c.href === "/settings"), false);
  check("staff still see the rest", staff.some((c) => c.href === "/leads"), true);
}
{
  const renova = buildCommands(NAV, { ...base, tenantSlug: "renova" });
  check("the owning tenant sees its module", renova.some((c) => c.href === "/renova-only"), true);
}
{
  // The layout refuses a route whose module is switched off; the palette must
  // not offer it, or the two disagree in front of the user.
  const flagged = buildCommands(NAV, { ...base, pathAllowed: (h) => h !== "/marketing/campaigns" });
  check("a module switched off is not offered", flagged.some((c) => c.href === "/marketing/campaigns"), false);
  check("its siblings survive", flagged.some((c) => c.href === "/content-studio"), true);
}
{
  const vocab = buildCommands(NAV, { ...base, vocab: { members: "Members" } });
  check("labelKey follows the venue vocabulary", vocab.find((c) => c.href === "/clients")?.label, "Members");
  const noVocab = buildCommands(NAV, base);
  check("…and falls back to the written label", noVocab.find((c) => c.href === "/clients")?.label, "Clients");
}

// ─────────────────────────────────────────────────────────── ranking
{
  const all = buildCommands(NAV, base);
  check("exact beats everything", filterCommands(all, "leads")[0]!.href, "/leads");
  check("prefix ranks first", filterCommands(all, "camp")[0]!.href, "/marketing/campaigns");
  check("a word INSIDE the label is found", filterCommands(all, "studio")[0]!.href, "/content-studio");
  check("the group name surfaces its pages", filterCommands(all, "marketing").length >= 2, true);
  check("no match is empty, not everything", filterCommands(all, "zzzz"), []);
  // Alphabetical, not nav order: with no query you are scanning names you
  // already know, and predictable beats "considered".
  check(
    "an empty query lists everything alphabetically",
    filterCommands(all, "").map((c) => c.label),
    ["Appointments", "Campaigns", "Clients", "Contacts", "Content Studio", "Dashboard", "Leads", "Settings"],
  );
  check("whitespace is not a query", filterCommands(all, "   ")[0]!.label, "Appointments");
  // Score still decides the bands — the four label matches all come before the
  // two that only matched on their group — and alphabetical orders each band.
  check(
    "ties inside a score band are alphabetical too",
    filterCommands(all, "c").map((c) => c.label),
    ["Campaigns", "Clients", "Contacts", "Content Studio", "Appointments", "Leads"],
  );
  check("case does not matter", filterCommands(all, "LEADS")[0]!.href, "/leads");
  check("scoring an unrelated term is 0", scoreCommand({ href: "/x", label: "Leads", group: "" }, "zzz"), 0);
}

// ─────────────────────────────────────────────────────────── keymap
{
  const t = (over: Record<string, unknown>) => resolveAppShortcut({ key: "k", metaKey: true, ...over } as never);
  check("Cmd+K opens the palette", t({}), "palette");
  check("Ctrl+K too", t({ metaKey: false, ctrlKey: true }), "palette");
  check("Cmd+K works WHILE typing — it is the way out", t({ target: { tagName: "INPUT" } }), "palette");
  check("Alt+Cmd+K is someone else's shortcut", t({ altKey: true }), null);
  check("Cmd+Enter submits", resolveAppShortcut({ key: "Enter", metaKey: true }), "submit");
  check("Cmd+Enter submits from inside a field", resolveAppShortcut({ key: "Enter", metaKey: true, target: { tagName: "TEXTAREA" } }), "submit");
  check("Esc closes", resolveAppShortcut({ key: "Escape" }), "close");
  check("Esc closes even mid-typing", resolveAppShortcut({ key: "Escape", target: { tagName: "INPUT" } }), "close");
  check("? shows help", resolveAppShortcut({ key: "?" }), "help");
  check("? typed into a field is a question mark", resolveAppShortcut({ key: "?", target: { tagName: "TEXTAREA" } }), null);
  check("/ focuses search", resolveAppShortcut({ key: "/" }), "search");
  check("/ typed into a field is a slash", resolveAppShortcut({ key: "/", target: { tagName: "INPUT" } }), null);
  check("a plain letter is not a shortcut", resolveAppShortcut({ key: "k" }), null);
  check("contentEditable counts as typing", isTyping({ isContentEditable: true }), true);
  check("a div does not", isTyping({ tagName: "DIV" }), false);
  check("no target is not typing", isTyping(null), false);
}

console.log(`commands + shortcuts: ${passed} checks passed.`);
