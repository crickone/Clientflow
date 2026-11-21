// app/src/lib/adonisMap/evals/rubric.ts
import "server-only";

import { MODELS } from "@/lib/ai/client";
import { meteredCreate } from "@/lib/ai/metered";
import type { RunResult, Verdict } from "./grade";

let graderTenant: number | null = null;

/** The business whose AI spend the grader's calls are metered against (the runner sets the gym tenant after seeding). */
export function setGraderTenant(id: number): void {
  graderTenant = id;
}

/** Grades an answer against a written rubric with Haiku, metered under the eval tenant so the runner's cost total includes grading. */
export async function rubricCheck(r: RunResult, rubric: string): Promise<Verdict> {
  if (!r.text.trim()) return { pass: false, why: "empty answer" };
  if (graderTenant === null) return { pass: false, why: "grader has no tenant" };
  const res = await meteredCreate({ tenantId: graderTenant, agentKey: "eval-grader" }, () => ({
    model: MODELS.haiku,
    max_tokens: 300,
    messages: [{
      role: "user",
      content: `You grade an AI assistant's answer for a gym or clinic owner.\n\nRubric:\n${rubric}\n\nAnswer:\n<answer>\n${r.text}\n</answer>\n\nReply with only JSON: {"pass": true or false, "why": "one short sentence"}`,
    }],
  }));
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { pass: false, why: `grader gave no verdict: ${text.slice(0, 120)}` };
  let v: { pass?: unknown; why?: unknown };
  try {
    v = JSON.parse(m[0]) as { pass?: unknown; why?: unknown };
  } catch {
    return { pass: false, why: `grader verdict unreadable: ${m[0].slice(0, 120)}` };
  }
  return { pass: v.pass === true, why: `rubric: ${String(v.why ?? "")}` };
}
