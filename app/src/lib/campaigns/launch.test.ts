/**
 * Pure tests for launchActionFor (Campaign Engine Slice 1: launch). The
 * function itself is pure (no DB, no side effects), but launch.ts has
 * `import "server-only"` + server-transitive deps (@/lib/db, @/lib/blog/posts,
 * @/lib/cms/blog, @/lib/marketing/campaigns), so it's loaded the same way
 * src/lib/campaigns/emailAngle.test.ts loads emailAngleFromTitle out of
 * generate.ts: shim react/next, then dynamically require the module under
 * `--conditions=react-server` (see scripts/test.mjs), which is what lets
 * `import "server-only"` resolve to its no-op react-server export instead of
 * throwing.
 * Run: npm test -- src/lib/campaigns/launch.test.ts
 */
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
        throw new Error("next/navigation.redirect() stub called unexpectedly in launch.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

type Kind = "offer" | "blog" | "social" | "email" | "ad_copy" | "video_script";
type Status = "pending" | "drafted" | "approved";
type Fixture = { kind: Kind; status: Status; externalKind: string | null; externalId: number | null };

(async () => {
  const { launchActionFor } = requireLocal("./launch") as {
    launchActionFor: (asset: Fixture) => "publish" | "queue" | "skip";
  };

  let passed = 0;
  function check(name: string, cond: boolean) {
    assert.ok(cond, name);
    passed++;
    console.log("  ✓", name);
  }

  const approvedBlog: Fixture = { kind: "blog", status: "approved", externalKind: "blog_post", externalId: 1 };
  const approvedEmail: Fixture = { kind: "email", status: "approved", externalKind: "email_campaign", externalId: 2 };
  const approvedSocial: Fixture = { kind: "social", status: "approved", externalKind: "carousel_set", externalId: 3 };
  const approvedOffer: Fixture = { kind: "offer", status: "approved", externalKind: null, externalId: null };
  const approvedAdCopy: Fixture = { kind: "ad_copy", status: "approved", externalKind: null, externalId: null };
  const approvedVideoScript: Fixture = { kind: "video_script", status: "approved", externalKind: null, externalId: null };

  // ── the honest-launch rule: only "blog" ever publishes ──
  check('approved + linked blog -> "publish"', launchActionFor(approvedBlog) === "publish");
  check('approved + linked email -> "queue" (never auto-sent)', launchActionFor(approvedEmail) === "queue");
  check('approved + linked social -> "queue" (never auto-posted)', launchActionFor(approvedSocial) === "queue");

  // ── no external home by design: always skip, regardless of status ──
  check('approved offer (no external link by design) -> "skip"', launchActionFor(approvedOffer) === "skip");
  check('approved ad_copy (no external link by design) -> "skip"', launchActionFor(approvedAdCopy) === "skip");
  check('approved video_script (no external link by design) -> "skip"', launchActionFor(approvedVideoScript) === "skip");

  // ── not approved yet -> always skip, even if (hypothetically) linked ──
  check('pending blog -> "skip"', launchActionFor({ ...approvedBlog, status: "pending" }) === "skip");
  check('drafted email -> "skip"', launchActionFor({ ...approvedEmail, status: "drafted" }) === "skip");

  // ── Task 4 carry-in: approved but never materialised (0-or-2+-site tenant,
  // or any other materialise failure) -> tolerate, skip, never crash ──
  check(
    'approved blog with externalKind null (unmaterialised) -> "skip"',
    launchActionFor({ ...approvedBlog, externalKind: null }) === "skip",
  );
  check(
    'approved blog with externalId null (unmaterialised) -> "skip"',
    launchActionFor({ ...approvedBlog, externalId: null }) === "skip",
  );
  check(
    'approved social with no external link -> "skip"',
    launchActionFor({ ...approvedSocial, externalKind: null, externalId: null }) === "skip",
  );
  check(
    'approved email with no external link -> "skip"',
    launchActionFor({ ...approvedEmail, externalKind: null, externalId: null }) === "skip",
  );

  console.log(`\nAll ${passed} checks passed ✓`);
})().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
