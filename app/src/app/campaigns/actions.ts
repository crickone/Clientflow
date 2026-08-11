"use server";

import { revalidatePath } from "next/cache";

import { getCurrentMembership, requireAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/queries";
import {
  createCampaign,
  updateCampaign,
  type CampaignAudience,
  type CampaignRecord,
} from "@/lib/marketing/campaigns";
import { markCampaignSending, precheckCampaign, runCampaignSend } from "@/lib/marketing/send";
import { runWithTenant } from "@/lib/db/tenant";
import { draftCampaignEmail } from "@/lib/ai/draftCampaign";
import { MODELS } from "@/lib/ai/client";
import { assertUnderCap, recordUsage } from "@/lib/ai/usage";

/**
 * Server actions for the campaign composer (Task 4). Mirrors
 * campaigns/domains/actions.ts's gating exactly: every action is admin-only,
 * and the tenant is always the SERVER's idea of "current membership" — never
 * a value the client supplies. Draft-only editing is enforced one layer down
 * (lib/marketing/campaigns.ts's updateCampaign, which throws
 * CampaignNotDraftError); these actions just translate that guard — and any
 * other failure — into a clean {ok:false,error} result instead of letting a
 * thrown Error reach the client as a generic Server Actions error digest.
 */

export interface CampaignFormInput {
  name: string;
  subject: string;
  preheader?: string | null;
  fromName: string;
  fromEmail: string;
  bodyHtml?: string;
  audience?: CampaignAudience;
}

export type CampaignActionResult =
  | { ok: true; campaign: CampaignRecord }
  | { ok: false; error: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The current session's tenant — NEVER read from client input. Throws if unauthenticated. */
function tenantId(): number {
  const m = getCurrentMembership();
  if (!m) throw new Error("UNAUTHENTICATED");
  return m.tenant.id;
}

function normalizeAudience(a: CampaignAudience | undefined): CampaignAudience {
  if (a && a.kind === "tag" && a.tag.trim()) return { kind: "tag", tag: a.tag.trim() };
  return { kind: "all_subscribed" };
}

interface CleanCampaignInput {
  name: string;
  subject: string;
  preheader: string | null;
  fromName: string;
  fromEmail: string;
  bodyHtml: string;
  audience: CampaignAudience;
}

/** Shared field validation for create + update — re-checked server-side, never trusts the client's own form validation. */
function validate(
  input: CampaignFormInput,
): { ok: true; value: CleanCampaignInput } | { ok: false; error: string } {
  const name = String(input?.name ?? "").trim();
  const subject = String(input?.subject ?? "").trim();
  const fromName = String(input?.fromName ?? "").trim();
  const fromEmail = String(input?.fromEmail ?? "").trim().toLowerCase();
  const preheader = input?.preheader ? String(input.preheader).trim() : null;
  const bodyHtml = typeof input?.bodyHtml === "string" ? input.bodyHtml : "";
  const audience = normalizeAudience(input?.audience);

  if (!name) return { ok: false, error: "Give the campaign a name." };
  if (!subject) return { ok: false, error: "Add a subject line." };
  if (!fromName) return { ok: false, error: "Add a from name." };
  if (!fromEmail || !EMAIL_RE.test(fromEmail)) {
    return { ok: false, error: "Enter a valid from address." };
  }

  return { ok: true, value: { name, subject, preheader, fromName, fromEmail, bodyHtml, audience } };
}

/** Create a new draft campaign and return it (the caller redirects into /campaigns/[id]). */
export async function createCampaignAction(input: CampaignFormInput): Promise<CampaignActionResult> {
  const user = await requireAdmin();
  const valid = validate(input);
  if (!valid.ok) return valid;

  try {
    const campaign = createCampaign({ ...valid.value, createdBy: user.id });
    await logActivity("campaigns.create", `Created campaign "${campaign.name}"`);
    revalidatePath("/campaigns");
    return { ok: true, campaign };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't create the campaign." };
  }
}

/** Save changes to an existing DRAFT campaign. Refuses (via CampaignNotDraftError) once it's left draft. */
export async function updateCampaignAction(
  id: number,
  input: CampaignFormInput,
): Promise<CampaignActionResult> {
  await requireAdmin();
  const valid = validate(input);
  if (!valid.ok) return valid;

  try {
    const campaign = updateCampaign(id, valid.value);
    await logActivity("campaigns.update", `Updated campaign "${campaign.name}"`);
    revalidatePath(`/campaigns/${id}`);
    revalidatePath("/campaigns");
    return { ok: true, campaign };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't save the campaign." };
  }
}

export interface CampaignDraftFormInput {
  subject: string;
  topic: string;
  tone?: string;
  /** Free-text "who this is going to" hint for the model — distinct from the campaign's structured audience targeting. */
  audience?: string;
  targetWords?: number;
}

export type CampaignDraftActionResult = { ok: true; content: string } | { ok: false; error: string };

/**
 * Draft an email body with AI. A paid call — bracketed by assertUnderCap
 * (before) / recordUsage (after), same pattern as runBlogGeneration /
 * draftBlogPostTool, under its own "campaign_draft" agentKey so the spend
 * breakdown on the Agents page stays meaningful. Never persists anything —
 * the returned content is set into the composer's body field client-side;
 * the operator still has to Save.
 */
export async function draftCampaignBodyAction(
  input: CampaignDraftFormInput,
): Promise<CampaignDraftActionResult> {
  await requireAdmin();
  const tid = tenantId();

  const subject = String(input?.subject ?? "").trim();
  const topic = String(input?.topic ?? "").trim();
  if (!subject) return { ok: false, error: "Add a subject line first." };
  if (!topic) return { ok: false, error: "Describe what this email is about." };
  const targetWordsInput = Number(input?.targetWords);
  const targetWords = Number.isFinite(targetWordsInput) && targetWordsInput > 0 ? Math.round(targetWordsInput) : 150;

  try {
    assertUnderCap(tid);
    const result = await draftCampaignEmail({
      subject,
      topic,
      tone: input?.tone?.trim() || null,
      audience: input?.audience?.trim() || null,
      targetWords,
    });
    recordUsage(tid, "campaign_draft", MODELS.opus, {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheReadTokens: result.usage.cacheReadInputTokens,
      cacheCreateTokens: result.usage.cacheCreationInputTokens,
    });
    return { ok: true, content: result.content };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't draft the email body." };
  }
}

export type SendCampaignActionResult = { ok: true } | { ok: false; error: string };

/**
 * Send a draft campaign (Task 5). Validates with precheckCampaign, then
 * atomically flips draft -> sending (markCampaignSending), then kicks off
 * the actual throttled batch send as a DETACHED continuation — `void
 * runWithTenant(tenantId, () => runCampaignSend(...))`, the same
 * fire-and-forget shape the agent chat route uses (the request returns
 * immediately; the send survives because Railway runs this app as a
 * persistent `next start` process, not serverless). Credits are metered
 * per BATCH inside runCampaignSend itself, never all-up-front here.
 */
export async function sendCampaignAction(id: number): Promise<SendCampaignActionResult> {
  await requireAdmin();
  const tid = tenantId();

  const pre = await precheckCampaign(tid, id);
  if (!pre.ok) return pre;

  const marked = markCampaignSending(tid, id);
  if (!marked.ok) return marked;

  await logActivity("campaigns.send", `Started sending campaign to ${pre.recipients} recipient(s)`);
  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/campaigns");

  // Fire-and-forget: intentionally not awaited. See the doc comment above.
  void runWithTenant(tid, () => runCampaignSend(tid, id));

  return { ok: true };
}
