// Run: npm test -- src/components/layout/commandKCoverage.test.ts
//
// Cmd+K has to work on every screen, and the thing that decides whether it
// does is not the palette — it is src/app/layout.tsx, which returns FOUR
// different documents. The palette lived in AppShell, one of those four, so it
// silently died on the Studio: a whole authenticated screen where the shortcut
// the operator had just learned did nothing.
//
// This reads the layout and asserts every document it renders either mounts the
// keymap or is listed below with a reason. A fifth branch added later fails
// here rather than shipping another dead screen.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Documents that deliberately have no palette. Reason required. */
const NO_PALETTE: { marker: string; why: string }[] = [
  {
    // <body>{children}</body> — the public CMS-served sites and form share links.
    marker: "<body>{children}",
    why: "public pages served to a tenant's visitors: no session, no app destinations, and the app's bundle has no business being there",
  },
  {
    marker: "<ClientAppFrame",
    why: "the client mobile app is a different product for members, not operators; the palette indexes the staff sidebar",
  },
  {
    marker: "is temporarily unavailable",
    why: "the client app's billing-paused screen: a member with no access, and nowhere to navigate to",
  },
];

const src = readFileSync(join(process.cwd(), "src", "app", "layout.tsx"), "utf8");

/** Each `<body>` … `</body>` the layout can render. */
function documents(source: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const open = source.indexOf("<body>", from);
    if (open === -1) break;
    const close = source.indexOf("</body>", open);
    assert.notEqual(close, -1, "unbalanced <body> in layout.tsx");
    out.push(source.slice(open, close));
    from = close + 1;
  }
  return out;
}

const docs = documents(src);
// Five today: public, Studio, the client app and its billing-paused screen
// (each its own document), and the operator app.
assert.ok(docs.length >= 5, `Expected 5+ documents in layout.tsx, found ${docs.length} — did the shape change?`);

const dead: string[] = [];
for (const doc of docs) {
  // AppShell mounts CommandK itself; a branch may also mount it directly.
  if (doc.includes("<CommandK") || doc.includes("<AppShell")) continue;
  if (NO_PALETTE.some((x) => doc.includes(x.marker))) continue;
  dead.push(doc.split("\n").slice(0, 4).join("\n"));
}

assert.equal(
  dead.length,
  0,
  `A document rendered by layout.tsx has no Cmd+K. Mount <CommandK> in it, or add it to ` +
    `NO_PALETTE with the reason it should not have one:\n${dead.join("\n---\n")}`,
);

// The bindings and the surface must not drift apart again: AppShell no longer
// owns a keymap of its own, and the palette is only ever reached through
// CommandK. Two copies of a window keydown listener is how this broke.
const shell = readFileSync(join(process.cwd(), "src", "components", "layout", "AppShell.tsx"), "utf8");
assert.ok(!shell.includes("resolveAppShortcut"), "AppShell has its own keymap again — it belongs in CommandK, which every shell can mount.");
assert.ok(shell.includes("<CommandK"), "AppShell no longer mounts CommandK.");

const palette = readFileSync(join(process.cwd(), "src", "components", "layout", "CommandPalette.tsx"), "utf8");
// A hand-rolled overlay cannot open over a Radix modal: the body gets
// pointer-events: none and focus is trapped in the layer underneath. See the
// note at the top of CommandPalette.
assert.ok(
  palette.includes("DialogPrimitive.Content"),
  "The palette must stay a Radix dialog, or it opens unclickable over any open panel.",
);

console.log(`commandKCoverage: ${docs.length} documents, ${docs.length - NO_PALETTE.length} carry Cmd+K, ${NO_PALETTE.length} excluded with reasons.`);
