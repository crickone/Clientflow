// Run: npm test -- src/lib/agents/specialistToolSlice.test.ts
//
// Verifies the specialist-registry generalization (Marketing Task 2): EVERY
// specialist registered in SPECIALISTS (@/lib/agents/specialists) has a
// toolNames list where every entry resolves to a real tool in TOOLS — the
// same per-name check salesToolSlice.test.ts (Task 8) did for sales alone,
// now run for every specialist so a typo in sales.ts, marketing.ts,
// operations.ts, OR orchestrator.ts is caught. Also pins the sales tool slice
// to the EXACT same 9 names it had before this generalization (Sales must
// behave identically), pins Marketing's shape + the required "can't post/
// schedule" honesty line in its base playbook, (Operations Task 1) pins
// Operations' shape + its "does not mark attendance itself" honesty line,
// and (Orchestrator Task 2) pins Orchestrator's shape — exactly the 3
// delegate_to_<specialist> tools, no domain tools of its own — + its
// "requires the operator's approval" honesty line.
//
// This matters because `Array.prototype.filter` silently drops any name that
// doesn't match — a typo in a specialist's toolNames (or a tool renamed in
// @/lib/assistant/tools without updating the specialist list) would quietly
// shrink that agent's tool slice with no error anywhere, not even at
// runtime. Pure/static: no route, HTTP, DB writes, or credentials required.
//
// Replaces salesToolSlice.test.ts (Task 8) — same checks, generalized to
// every entry in SPECIALISTS instead of hardcoding SALES_SPECIALIST.
//
// Concierge Task 1: orchestrator's toolNames grows a 4th delegate,
// delegate_to_concierge (checks (f) below updated 3 -> 4 accordingly). The
// Concierge itself is deliberately NOT a SPECIALISTS entry — see check (g) —
// its system/tools are computed at runtime by conciergeToolSlice, not a
// registered playbook + toolNames list like every other specialist here.
//
// NOTE: this repo does NOT use vitest — tests are plain node:assert/strict
// scripts run via `npm test -- <path>` (see scripts/test.mjs). Mirrors the
// Module._load shim pattern from tools.sales.test.ts / context.test.ts
// (Tasks 6/7), needed because @/lib/assistant/tools -> @/lib/db/tenant
// (React's server-only `cache`) and, separately, ->
// @/lib/agents/tools.sales -> @/lib/leads / @/lib/pipeline/stage /
// @/lib/whatsapp/send / @/lib/ai/draftFollowup -> @/lib/db (the ambient `db`
// proxy) -> @/lib/tenants -> @/lib/auth -> `next/navigation` — both at module
// scope. Under the runner's `--conditions=react-server`, npm's react
// "react-server" entry point throws on load, so `cache` needs stubbing;
// next/navigation's real module drags in Next's client-router internals we
// have no reason to load here (redirect() is never called in this test).
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
        throw new Error("next/navigation.redirect() stub called unexpectedly in specialistToolSlice.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as salesToolSlice.test.ts).
(async () => {
  const { TOOLS } = requireLocal("../assistant/tools") as typeof import("../assistant/tools");
  const { SPECIALISTS } = requireLocal("./specialists") as typeof import("./specialists");
  const { SALES_SPECIALIST } = requireLocal("./specialists/sales") as typeof import("./specialists/sales");

  const toolsByName = new Map(TOOLS.map((t) => [t.name, t]));

  // ── (a) SPECIALISTS registers exactly the four agents active today. This
  // is an intentional pin, not an assumption: a future task activating
  // another specialist (e.g. SEO) is expected to update this line alongside
  // it. ──
  assert.deepEqual(
    Object.keys(SPECIALISTS).sort(),
    ["marketing", "operations", "orchestrator", "sales"],
    "SPECIALISTS registers exactly sales + marketing + operations + orchestrator",
  );

  // ── (b) for EVERY specialist, every toolNames entry resolves to a real
  // tool in TOOLS — checked BY NAME, not just by count, so a typo is caught
  // even if it happened to leave the slice's length unchanged — and the
  // computed slice (exactly what the chat route builds via
  // `TOOLS.filter((t) => allowed.has(t.name))`) has exactly toolNames.length
  // tools: no dupes, no silent drops. ──
  for (const [key, spec] of Object.entries(SPECIALISTS)) {
    for (const name of spec.toolNames) {
      assert.ok(
        toolsByName.has(name),
        `${key}: SPECIALISTS.${key}.toolNames entry "${name}" must resolve to a real tool registered in TOOLS`,
      );
    }
    const allowed = new Set<string>(spec.toolNames);
    const slice = TOOLS.filter((t) => allowed.has(t.name));
    assert.equal(
      slice.length,
      spec.toolNames.length,
      `${key}: the computed tool slice has exactly one entry per toolNames entry (no dupes, no silent drops)`,
    );
  }

  // ── (c) Sales must behave IDENTICALLY after the generalization: the
  // registry holds the SAME object (not a copy/fork), so its base playbook
  // is byte-identical, and its tool slice is the exact same 9 names it had
  // before this task. ──
  assert.equal(
    SPECIALISTS.sales,
    SALES_SPECIALIST,
    "SPECIALISTS.sales is the same SALES_SPECIALIST object reference — the registry does not fork or copy it",
  );
  assert.equal(
    SPECIALISTS.sales.basePlaybook,
    SALES_SPECIALIST.basePlaybook,
    "the sales base playbook composeAgentSystem reads via SPECIALISTS is byte-identical to SALES_SPECIALIST.basePlaybook",
  );
  const EXPECTED_SALES_TOOLS = [
    "list_leads", "get_lead_health", "get_client",
    "draft_lead_reply", "send_client_email", "send_whatsapp",
    "set_lead_stage", "log_lead_touch", "create_calendar_event",
  ];
  assert.deepEqual(
    [...SPECIALISTS.sales.toolNames].sort(),
    [...EXPECTED_SALES_TOOLS].sort(),
    "SALES_SPECIALIST.toolNames is unchanged by the generalization — same 9 names as before Marketing Task 2",
  );

  // ... and the slice still excludes a known non-sales tool, proving the
  // filter narrows TOOLS rather than passing everything through.
  const nonSalesTool = "create_workout_program";
  assert.ok(toolsByName.has(nonSalesTool), "sanity: the chosen non-sales tool actually exists in TOOLS");
  const salesAllowed = new Set<string>(SPECIALISTS.sales.toolNames);
  assert.ok(!salesAllowed.has(nonSalesTool), "sanity: the chosen non-sales tool is not in the sales tool slice");

  // ── (d) Marketing's shape is pinned too: exactly the 6 tools from
  // Marketing Task 1 (5 blog/carousel tools + business_overview), and its
  // base playbook contains — verbatim — the required honesty line that it
  // cannot post to social or schedule posts. This is the #1 non-negotiable
  // of Marketing Task 2: the agent must never imply it did something the
  // infra can't actually do. ──
  assert.equal(SPECIALISTS.marketing.toolNames.length, 6, "MARKETING_SPECIALIST.toolNames has exactly 6 entries");
  assert.deepEqual(
    [...SPECIALISTS.marketing.toolNames].sort(),
    ["business_overview", "draft_blog_post", "draft_carousel", "list_blog_posts", "publish_blog_post", "save_blog_post"].sort(),
    "MARKETING_SPECIALIST.toolNames is exactly the 6 expected tools",
  );
  assert.ok(
    SPECIALISTS.marketing.basePlaybook.includes(
      "You CANNOT post to social media or schedule posts yet",
    ),
    "MARKETING_SPECIALIST.basePlaybook contains the required honesty line about not being able to post/schedule",
  );

  // ── (e) Operations' shape is pinned too (Operations Task 1): exactly the
  // 10 tools named in OPERATIONS_SPECIALIST.toolNames — the 2 new read tools
  // (list_no_shows, list_lapsed_members, from @/lib/agents/tools.operations)
  // plus 8 reused as-is from the general assistant registry — and its base
  // playbook contains, verbatim, the honesty line that it never marks
  // attendance itself, only surfaces no-shows staff already recorded (the
  // same "never claim an action happened" spirit as Marketing's post/
  // schedule line above, specific to Operations' domain). ──
  assert.equal(SPECIALISTS.operations.toolNames.length, 10, "OPERATIONS_SPECIALIST.toolNames has exactly 10 entries");
  assert.deepEqual(
    [...SPECIALISTS.operations.toolNames].sort(),
    [
      "list_no_shows", "list_lapsed_members",
      "list_classes", "list_appointments", "get_client", "business_overview",
      "send_client_email", "send_client_whatsapp",
      "reschedule_appointment", "book_client_into_class",
    ].sort(),
    "OPERATIONS_SPECIALIST.toolNames is exactly the 10 expected tools",
  );
  assert.ok(
    SPECIALISTS.operations.basePlaybook.includes("you do not mark attendance yourself"),
    "OPERATIONS_SPECIALIST.basePlaybook contains the required honesty line about not marking attendance itself",
  );

  // ── (f) Orchestrator's shape is pinned too (Orchestrator Task 2; Concierge
  // Task 1 adds the 4th): exactly the 4 delegate_to_<specialist> tools — no
  // domain tools of its own, since it routes rather than does — and its base
  // playbook contains, verbatim, the honesty line that a specialist's
  // proposed writes still require the operator's approval (the same "never
  // claim work is done" spirit as Marketing's post/schedule line and
  // Operations' attendance line above, specific to a THIN routing agent whose
  // only real actions happen inside delegated specialist turns). Also
  // confirms delegation can't recurse: the orchestrator does not appear in
  // its own toolNames or any other specialist's — enforced at runtime by
  // tools.orchestrator.ts's DELEGATABLE allowlist (see
  // tools.orchestrator.test.ts), pinned here as a static cross-check that no
  // specialist (including orchestrator itself) is ever given a
  // delegate_to_* tool. ──
  assert.equal(SPECIALISTS.orchestrator.toolNames.length, 4, "ORCHESTRATOR_SPECIALIST.toolNames has exactly 4 entries");
  assert.deepEqual(
    [...SPECIALISTS.orchestrator.toolNames].sort(),
    ["delegate_to_concierge", "delegate_to_marketing", "delegate_to_operations", "delegate_to_sales"],
    "ORCHESTRATOR_SPECIALIST.toolNames is exactly the 4 delegate tools",
  );
  assert.ok(
    SPECIALISTS.orchestrator.basePlaybook.includes(
      "still requires the operator's approval",
    ),
    "ORCHESTRATOR_SPECIALIST.basePlaybook contains the required honesty line about needing operator approval",
  );
  assert.ok(
    SPECIALISTS.orchestrator.basePlaybook.includes("Concierge"),
    "ORCHESTRATOR_SPECIALIST.basePlaybook mentions the Concierge as where general/admin/money/inbox/plan work is routed",
  );
  for (const [key, spec] of Object.entries(SPECIALISTS)) {
    if (key === "orchestrator") continue; // orchestrator legitimately holds all 4 — pinned exactly, above
    assert.ok(
      !spec.toolNames.some((n) => n.startsWith("delegate_to_")),
      `${key}: no specialist other than orchestrator may hold a delegate_to_* tool — that would allow recursive/nested delegation`,
    );
  }

  // ── (g) The Concierge is deliberately NOT a SPECIALISTS entry — unlike
  // Sales/Marketing/Operations/Orchestrator, it has no fixed playbook or
  // toolNames list registered here; delegate_to_concierge
  // (@/lib/agents/tools.orchestrator) computes its system + tools at runtime
  // instead (buildAssistantSystem + conciergeToolSlice, the same pair
  // `/api/assistant/chat` uses per-request). Pinned so a future refactor
  // doesn't accidentally register one. ──
  assert.ok(!("concierge" in SPECIALISTS), "concierge is not a SPECIALISTS entry");

  console.log("specialistToolSlice.test.ts: all assertions passed");
})();
