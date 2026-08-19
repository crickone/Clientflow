/**
 * Pure tests for emailAngleFromTitle (Campaign Engine Slice 1: email asset
 * angle derivation). The function itself has zero DB imports, but generate.ts
 * (which exports it) has `import "server-only"` + server-transitive deps via
 * `getBusinessContext`, `draftCampaignEmail`, etc. Shim react/next modules as
 * per src/lib/campaigns/store.test.ts pattern, then dynamically require the
 * export under test.
 * Run: npm test -- src/lib/campaigns/emailAngle.test.ts
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
        throw new Error("next/navigation.redirect() stub called unexpectedly in emailAngle.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { emailAngleFromTitle } = requireLocal("./generate") as {
    emailAngleFromTitle: (title: string) => "announce" | "proof" | "last_chance";
  };

  let passed = 0;
  function check(name: string, cond: boolean) {
    assert.ok(cond, name);
    passed++;
    console.log("  ✓", name);
  }

  // Basic angle derivation from stable titles
  check(
    'emailAngleFromTitle("Email — Announce") returns "announce"',
    emailAngleFromTitle("Email — Announce") === "announce",
  );

  check(
    'emailAngleFromTitle("Email — Proof") returns "proof"',
    emailAngleFromTitle("Email — Proof") === "proof",
  );

  check(
    'emailAngleFromTitle("Email — Last chance") returns "last_chance"',
    emailAngleFromTitle("Email — Last chance") === "last_chance",
  );

  // Fallback to "announce" for unrecognized titles
  check(
    'emailAngleFromTitle("something random") returns "announce" (fallback)',
    emailAngleFromTitle("something random") === "announce",
  );

  check(
    'emailAngleFromTitle("") returns "announce" (fallback on empty)',
    emailAngleFromTitle("") === "announce",
  );

  // Case-insensitive matching
  check(
    'emailAngleFromTitle("email — proof") (lowercase) returns "proof"',
    emailAngleFromTitle("email — proof") === "proof",
  );

  check(
    'emailAngleFromTitle("EMAIL — LAST CHANCE") (uppercase) returns "last_chance"',
    emailAngleFromTitle("EMAIL — LAST CHANCE") === "last_chance",
  );

  // Regression: the stable label survives re-derivation (key test for the fix)
  check(
    'Re-derivation: emailAngleFromTitle(original stable title) survives regeneration',
    emailAngleFromTitle("Email — Proof") === "proof",
  );

  console.log(`\nAll ${passed} checks passed ✓`);
})().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
