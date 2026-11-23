// app/src/lib/adonisMap/evals/run.ts
// Run from app/: npm run eval:adonis -- --map off|on [--only q15] [--max-eur 10]
//
// Builds the made-up gym and clinic in a throwaway directory (never the real
// dev or production data), asks Adonis each question through the real turn
// loop with no approvals given, grades the answers, and writes the results
// to app/evals/adonis/results/. Calls paid models: run by hand, never in CI.
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => { throw new Error("redirect() called in the eval runner"); },
      notFound: () => { throw new Error("notFound() called in the eval runner"); },
    };
  }
  if (request === "next/cache") return { revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const map = arg("--map");
const only = arg("--only");
const maxEur = Number(arg("--max-eur") ?? 10);
if ((map !== "on" && map !== "off") || !Number.isFinite(maxEur) || maxEur <= 0) {
  console.error("Usage: npm run eval:adonis -- --map on|off [--only q15] [--max-eur 10]  (--max-eur must be a positive number)");
  process.exit(2);
}

const APP = process.cwd();
function loadEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv(path.join(APP, ".env.local"));
loadEnv(path.join(APP, ".env"));
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set (looked in app/.env.local and app/.env).");
  process.exit(2);
}

// `railway run` hands this process PRODUCTION settings. Importing the app arms
// its in-process jobs (nightly backup, ticker, daily jobs), and with production
// credentials they reach real services: on 2026-11-21..23 the backup job
// uploaded these throwaway databases to the production backup buckets. Keep
// only the model keys and the basics; nothing else can be reached from here.
const KEEP_ENV = new Set(["ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "PATH", "HOME", "TMPDIR", "TERM", "LANG", "NODE_OPTIONS", "USER", "SHELL"]);
for (const k of Object.keys(process.env)) if (!KEEP_ENV.has(k)) delete process.env[k];
(process.env as Record<string, string>).NODE_ENV = "development";

// Everything below reads and writes ./data under this throwaway directory.
const work = fs.mkdtempSync(path.join(os.tmpdir(), "adonis-eval-"));
process.chdir(work);

(async () => {
  const { controlSqlite } = requireLocal("../../db/control") as typeof import("../../db/control");
  const { runWithTenant } = requireLocal("../../db/tenant") as typeof import("../../db/tenant");
  const { setSchedulingMode } = requireLocal("../../settings") as typeof import("../../settings");
  const { ensureAgents } = requireLocal("../../agents/registry") as typeof import("../../agents/registry");
  const { resolveChatAgent } = requireLocal("../../agents/chatAgent") as typeof import("../../agents/chatAgent");
  const { composeAgentSystem } = requireLocal("../../agents/context") as typeof import("../../agents/context");
  const { runAgentTurn } = requireLocal("../../agents/runAgentTurn") as typeof import("../../agents/runAgentTurn");
  const { getProvider } = requireLocal("../../ai/providers") as typeof import("../../ai/providers");
  const { setPlatformFlag } = requireLocal("../../platform/flags") as typeof import("../../platform/flags");
  const { getMonthlyUsageCents } = requireLocal("../../ai/usage") as typeof import("../../ai/usage");
  const { dublinDate } = requireLocal("../engine") as typeof import("../engine");
  const { seedClinic, seedGym } = requireLocal("./fixture") as typeof import("./fixture");
  const { computeTruth } = requireLocal("./truth") as typeof import("./truth");
  const { QUESTIONS } = requireLocal("./questions") as typeof import("./questions");
  const { setGraderTenant } = requireLocal("./rubric") as typeof import("./rubric");

  const today = dublinDate(Date.now());
  const mk = (slug: string, name: string) =>
    (controlSqlite.prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id").get(slug, name, `tenants/${slug}/${slug}.db`) as { id: number }).id;
  const gymId = mk("eval-gym", "Northside Fitness");
  const clinicId = mk("eval-clinic", "Riverside Recovery Clinic");
  runWithTenant(gymId, () => setSchedulingMode("timetable"));
  runWithTenant(clinicId, () => setSchedulingMode("appointments"));
  const gym = seedGym(gymId, today);
  const clinic = seedClinic(clinicId, today);
  setGraderTenant(gymId);
  ensureAgents(gymId);
  ensureAgents(clinicId);
  setPlatformFlag({ key: "adonis_map", mode: map === "on" ? "allow" : "none", percent: 100, allow: map === "on" ? [gymId, clinicId] : [] });
  const truth = computeTruth({ gymId, clinicId, today, gym, clinicNames: clinic.names });

  const questions = QUESTIONS.filter((q) => !only || q.id === only);
  console.log(`Adonis test set: map ${map}, ${questions.length} questions, ${today}. Calls paid models; stops at about EUR ${maxEur}.`);
  const results: Record<string, unknown>[] = [];
  let model = "";
  const outDir = path.join(APP, "evals", "adonis", "results");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = `${today}-map-${map}${only ? `-${only}` : ""}`;
  const costNow = () => (getMonthlyUsageCents(gymId) + getMonthlyUsageCents(clinicId)) / 100;
  // Overwritten after every question, so a later crash keeps the earlier answers.
  const saveJson = () =>
    fs.writeFileSync(path.join(outDir, `${stamp}.json`), JSON.stringify({ map, today, model, costEur: costNow(), passed: results.filter((x) => x.pass).length, total: results.length, results }, null, 2));
  for (const q of questions) {
    const tid = q.variant === "gym" ? gymId : clinicId;
    const agent = resolveChatAgent(tid, "orchestrator");
    if (!agent) throw new Error("Adonis is not set up on the eval business.");
    model = agent.model;
    const system = runWithTenant(tid, () => composeAgentSystem(tid, "orchestrator"));
    const toolCalls: { name: string; input: Record<string, unknown> }[] = [];
    const base = getProvider(agent.model);
    const provider = {
      streamTurn: async (a: Parameters<typeof base.streamTurn>[0]) => {
        const r = await base.streamTurn(a);
        for (const c of r.toolCalls ?? []) toolCalls.push({ name: c.name, input: c.input });
        return r;
      },
    };
    const started = Date.now();
    let out: Awaited<ReturnType<typeof runAgentTurn>> | null = null;
    let error: string | null = null;
    try {
      out = await runWithTenant(tid, () => runAgentTurn({
        tenantId: tid, agentKey: "orchestrator", model: agent.model, system, tools: agent.tools,
        messages: [{ role: "user", content: q.text }], provider, maxTurns: 10,
      }));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const r = { text: out?.text ?? "", pendingWrites: (out?.pendingWrites ?? []).map((w) => ({ name: w.name, input: w.input })), toolCalls };
    let verdict: { pass: boolean; why: string };
    if (error) verdict = { pass: false, why: `run failed: ${error}` };
    else {
      try {
        verdict = await q.check(r, truth);
      } catch (err) {
        verdict = { pass: false, why: `grader failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    results.push({ id: q.id, category: q.category, question: q.text, pass: verdict.pass, why: verdict.why, ms: Date.now() - started, answer: r.text, toolCalls, pendingWrites: r.pendingWrites });
    saveJson();
    console.log(`${verdict.pass ? "PASS" : "FAIL"} ${q.id} ${q.text}${verdict.pass ? "" : ` (${verdict.why})`}`);
    const spentCents = getMonthlyUsageCents(gymId) + getMonthlyUsageCents(clinicId);
    if (spentCents > maxEur * 100) {
      console.log(`Stopped: spend reached EUR ${(spentCents / 100).toFixed(2)}.`);
      break;
    }
  }

  const costEur = costNow();
  const passed = results.filter((x) => x.pass).length;
  saveJson();
  const cats = [...new Set(results.map((x) => String(x.category)))];
  const md = [
    `# Adonis test set: map ${map}, ${today}`,
    "",
    `Score: ${passed} of ${results.length}. Model: ${model}. Cost about EUR ${costEur.toFixed(2)}, grading included.`,
    "",
    "| Category | Passed |",
    "|---|---|",
    ...cats.map((c) => { const rs = results.filter((x) => x.category === c); return `| ${c} | ${rs.filter((x) => x.pass).length} of ${rs.length} |`; }),
    "",
    "## Failures",
    "",
    ...results.filter((x) => !x.pass).map((x) => `- **${x.id}** ${x.question}: ${x.why}. Tools: ${(x.toolCalls as { name: string }[]).map((c) => c.name).join(", ") || "none"}.`),
  ].join("\n");
  fs.writeFileSync(path.join(outDir, `${stamp}.md`), md + "\n");
  console.log(`\n${passed} of ${results.length} passed. Results: evals/adonis/results/${stamp}.md`);
  fs.rmSync(work, { recursive: true, force: true });
  // The app's timers would keep this process alive for days: end it here.
  process.exit(0);
})().catch((err) => {
  console.error(err);
  fs.rmSync(work, { recursive: true, force: true });
  process.exit(1);
});
