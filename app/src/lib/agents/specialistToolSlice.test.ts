// Run: npm test -- src/lib/agents/specialistToolSlice.test.ts
//
// Verifies the agent registry (@/lib/agents/specialists) for the single-agent
// product: EVERY entry in SPECIALISTS has a toolNames list where every entry
// resolves to a real tool in TOOLS (@/lib/assistant/tools), and the computed
// slice (exactly what the chat route builds via
// `TOOLS.filter((t) => allowed.has(t.name))`) has one tool per name — no dupes,
// no silent drops. This matters because `Array.prototype.filter` silently drops
// any name that doesn't match: a typo in a toolNames entry (or a tool renamed
// in @/lib/assistant/tools without updating the list) would quietly shrink the
// agent's tool slice with no error anywhere, not even at runtime.
//
// Single-agent product (2026-08-25): SPECIALISTS now holds exactly ONE entry,
// Adonis ("orchestrator"). The Sales/Marketing/Operations specialist entries +
// spec files, and the whole delegate_to_* delegation subsystem, were retired
// once Adonis absorbed their tools + playbooks and started doing the work
// directly. Their TOOL LISTS live on inline in specialists/orchestrator.ts as
// Adonis's three domain groups; the pins below re-assert (from independent,
// hardcoded expected lists — the same lists the retired spec files held) that
// Adonis's toolNames union is a SUPERSET of each domain group, so "Adonis can
// still do everything the specialists could" holds by name, not by faith. Also
// pinned: Adonis carries every honesty line the specialists used to (never
// writes itself, can't auto-post social, one campaign-asset at a time, doesn't
// mark attendance), and — the security-relevant property — ZERO delegate_to_*
// tools anywhere.
//
// Pure/static: no route, HTTP, DB writes, or credentials required.
//
// NOTE: this repo does NOT use vitest — tests are plain node:assert/strict
// scripts run via `npm test -- <path>` (see scripts/test.mjs). Mirrors the
// Module._load shim pattern from context.test.ts, needed because
// @/lib/assistant/tools -> @/lib/db/tenant (React's server-only `cache`) and,
// separately, -> @/lib/agents/tools.sales -> @/lib/leads / @/lib/pipeline/stage
// / @/lib/whatsapp/send / @/lib/ai/draftFollowup -> @/lib/db (the ambient `db`
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
// top-level await is unsupported.
(async () => {
  const { TOOLS } = requireLocal("../assistant/tools") as typeof import("../assistant/tools");
  const { SPECIALISTS } = requireLocal("./specialists") as typeof import("./specialists");

  const toolsByName = new Map(TOOLS.map((t) => [t.name, t]));

  // ── (a) SPECIALISTS registers exactly Adonis. An intentional pin, not an
  // assumption: a future task re-introducing a specialist is expected to
  // update this line alongside it. ──
  assert.deepEqual(
    Object.keys(SPECIALISTS).sort(),
    ["orchestrator"],
    "SPECIALISTS registers exactly the one agent, Adonis (\"orchestrator\")",
  );

  // ── (b) for EVERY registered agent, every toolNames entry resolves to a
  // real tool in TOOLS — checked BY NAME, not just count, so a typo is caught
  // even if it left the slice's length unchanged — and the computed slice has
  // exactly toolNames.length tools: no dupes, no silent drops. ──
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

  // ── (c) Adonis absorbed every specialist's tools: its toolNames union is a
  // SUPERSET of each of the three domain groups. These expected lists are the
  // exact tool sets the retired Sales/Marketing/Operations spec files held —
  // pinned here independently (not imported from specialists/orchestrator.ts)
  // so a drop from Adonis's union is caught by name. ──
  const EXPECTED_LEAD_TOOLS = [
    "list_leads", "get_lead_health", "get_client",
    "draft_lead_reply", "send_client_email", "send_whatsapp",
    "set_lead_stage", "log_lead_touch", "create_calendar_event",
  ];
  const EXPECTED_MARKETING_TOOLS = [
    "list_blog_posts", "draft_blog_post", "save_blog_post",
    "publish_blog_post", "draft_carousel", "business_overview",
    "plan_campaign", "create_campaign", "draft_campaign_asset",
    "approve_campaign_asset", "launch_campaign",
  ];
  const EXPECTED_OPS_TOOLS = [
    "list_no_shows", "list_lapsed_members",
    "list_classes", "list_appointments", "get_client", "business_overview",
    "send_client_email", "send_client_whatsapp",
    "reschedule_appointment", "book_client_into_class",
  ];
  const adonisTools = new Set<string>(SPECIALISTS.orchestrator.toolNames);
  assert.ok(adonisTools.size > 0, "ORCHESTRATOR_SPECIALIST.toolNames is non-empty");
  for (const [group, names] of [
    ["leads", EXPECTED_LEAD_TOOLS],
    ["marketing", EXPECTED_MARKETING_TOOLS],
    ["operations", EXPECTED_OPS_TOOLS],
  ] as const) {
    for (const name of names) {
      assert.ok(
        adonisTools.has(name),
        `Adonis's toolNames must include "${name}" (from the ${group} group) — Adonis's union is a superset of every domain group's tools`,
      );
    }
  }

  // ── (d) The security property, checked for every registered agent: ZERO
  // delegate_to_* tools anywhere. Adonis works directly; the delegation
  // subsystem is gone and must never come back (it would reintroduce the
  // routing hop). ──
  for (const [key, spec] of Object.entries(SPECIALISTS)) {
    assert.ok(
      !spec.toolNames.some((n) => n.startsWith("delegate_to_")),
      `${key}: no agent may hold a delegate_to_* tool; Adonis works directly instead of delegating`,
    );
  }

  // ── (e) Adonis's combined playbook carries — verbatim — every honesty line
  // the specialists used to, plus its own direct-work framing. This is the #1
  // non-negotiable: the agent must never imply it did something the infra
  // can't do, or that a proposed action already happened. Pinned so a future
  // playbook edit can't silently drop one. ──
  const playbook = SPECIALISTS.orchestrator.basePlaybook;
  for (const [what, line] of [
    ["never executes a write itself", "you never send or save it yourself"],
    ["states its direct-work / no-routing framing up front", "you're the whole team in one"],
    ["can't auto-post or schedule social", "You can't auto-post or schedule social yet"],
    ["one campaign-asset at a time", "Never draft or approve more than one asset per turn"],
    ["doesn't mark attendance itself", "you don't mark attendance yourself"],
  ] as const) {
    assert.ok(
      playbook.includes(line),
      `ORCHESTRATOR_SPECIALIST.basePlaybook keeps the honesty line: ${what} ("${line}")`,
    );
  }

  // ── (f) The Concierge is deliberately NOT a SPECIALISTS entry — it never had
  // a fixed playbook/toolNames list here; its system + tools are computed at
  // runtime (buildAssistantSystem + conciergeToolSlice), and were folded into
  // Adonis's own toolNames. Pinned so a future refactor doesn't register one. ──
  assert.ok(!("concierge" in SPECIALISTS), "concierge is not a SPECIALISTS entry");

  console.log("specialistToolSlice.test.ts: all assertions passed");
})();
