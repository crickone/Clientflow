// Run: npm test -- src/lib/cms/pageDraft.test.ts
//
// Pure tests for canPublishDraft — the guard behind publishDraft() (Defect
// 4 in the Studio fix pass: nothing used to stop an empty or near-empty
// draft, a parse failure or a wiped-out subtree, from being published
// verbatim over a full page). canPublishDraft itself takes plain strings
// and returns a verdict; no DB, no I/O.
//
// NOTE: this repo does NOT use vitest — tests are plain node:assert/strict
// scripts run via `npm test -- <path>` (see scripts/test.mjs).
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

// ./pageDraft -> @/lib/db (the ambient `db` proxy) -> @/lib/db/tenant (react
// `cache`) and -> @/lib/tenants -> @/lib/auth -> next/navigation. Same
// two-part shim as src/lib/cms/blog.test.ts / src/lib/campaigns/store.test.ts,
// for the same reason: under the runner's `--conditions=react-server`, npm's
// react "react-server" entry throws on load, so `cache` needs stubbing; and
// next/navigation's real module drags in Next's client-router internals we
// have no reason to load here (redirect() is never actually exercised by
// this test's code path — canPublishDraft is pure). Installed via a dynamic
// require (below) rather than a static import, since a static
// `import ... from "./pageDraft"` would be hoisted and evaluated before this
// shim runs.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in pageDraft.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

(async () => {
  const { canPublishDraft, MIN_DRAFT_RETENTION } =
    requireLocal("./pageDraft") as typeof import("./pageDraft");

  const CURRENT = "x".repeat(40_000); // stand-in for a real ~40KB page

  // An empty draft is refused outright, regardless of the current size.
  const empty = canPublishDraft(CURRENT, "");
  check("empty draft is refused", empty.allowed === false);
  check(
    "empty draft is refused for the right reason",
    !empty.allowed && empty.reason === "empty",
  );

  // Whitespace-only is the same as empty — a draft that's nothing but
  // formatting is not a genuine edit either.
  const whitespace = canPublishDraft(CURRENT, "   \n\t  ");
  check("whitespace-only draft is refused", whitespace.allowed === false);
  check(
    "whitespace-only draft is refused as empty",
    !whitespace.allowed && whitespace.reason === "empty",
  );

  // A one-character draft against a 40KB page: drastically smaller, refused.
  const oneChar = canPublishDraft(CURRENT, "x");
  check("a one-character draft against a 40KB page is refused", oneChar.allowed === false);
  check(
    "a one-character draft is refused as too-small (not empty)",
    !oneChar.allowed && oneChar.reason === "too-small",
  );

  // Just under the threshold: refused.
  const justUnder = "x".repeat(Math.floor(CURRENT.length * MIN_DRAFT_RETENTION) - 1);
  check(
    "a draft just under the retention threshold is refused",
    canPublishDraft(CURRENT, justUnder).allowed === false,
  );

  // Exactly at (or just over) the threshold: allowed.
  const atThreshold = "x".repeat(Math.ceil(CURRENT.length * MIN_DRAFT_RETENTION));
  check(
    "a draft at the retention threshold is allowed",
    canPublishDraft(CURRENT, atThreshold).allowed === true,
  );

  // A normal edit that trims some copy but stays well above the floor.
  const trimmed = "x".repeat(Math.floor(CURRENT.length * 0.8));
  check("a draft that trims some copy but stays large is allowed", canPublishDraft(CURRENT, trimmed).allowed === true);

  // A draft that GROWS the page is obviously allowed.
  const grown = CURRENT + CURRENT;
  check("a draft larger than the current content is allowed", canPublishDraft(CURRENT, grown).allowed === true);

  // A brand-new page (empty current content) has nothing to shrink from —
  // any non-empty draft is allowed.
  const brandNew = canPublishDraft("", "<p>First words on a new page.</p>");
  check("any non-empty draft is allowed against empty current content", brandNew.allowed === true);

  // Current content that's whitespace-only behaves the same as empty current
  // content for the shrinkage check (trimmed length is 0).
  const currentWhitespace = canPublishDraft("   \n  ", "<p>New content.</p>");
  check(
    "a non-empty draft is allowed against whitespace-only current content",
    currentWhitespace.allowed === true,
  );

  console.log(`\n✓ ${passed} check(s) passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
