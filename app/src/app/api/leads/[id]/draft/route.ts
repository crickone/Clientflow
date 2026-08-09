import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import { getCurrentMembership } from "@/lib/auth";
import { addMessage, getLead, getLeadMessages } from "@/lib/leads";
import { draftFollowup } from "@/lib/ai/draftFollowup";
import { AiCapError } from "@/lib/ai/usage";
import { logActivity } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const membership = getCurrentMembership();
  if (!membership) {
    return NextResponse.json({ ok: false, error: "No active account" }, { status: 401 });
  }
  const id = Number(params.id);
  const lead = getLead(id);
  if (!lead) {
    return NextResponse.json(
      { ok: false, error: "Lead not found." },
      { status: 404 },
    );
  }
  const history = getLeadMessages(id);

  let draft;
  try {
    draft = await draftFollowup({ lead, history, tenantId: membership.tenant.id });
  } catch (err) {
    // AiCapError (tenant over its monthly AI spend cap) surfaces as a clean
    // 429, not a 500 — matches the assistant chat route's cap handling.
    if (err instanceof AiCapError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 429 });
    }
    const message =
      err instanceof Error ? err.message : "AI drafting failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  // Persist the draft as an outbound, AI-generated, not-yet-sent message.
  // The operator can review, edit, and mark sent later.
  const stored = addMessage({
    leadId: id,
    direction: "outbound",
    channel: lead.email ? "email" : "sms",
    content: draft.text,
    aiGenerated: true,
    sentAt: null,
  });

  await logActivity(
    "lead.draft",
    `AI drafted follow-up for lead #${id}`,
    {
      leadId: id,
      messageId: stored.id,
      cacheRead: draft.usage.cacheReadInputTokens,
      cacheWrite: draft.usage.cacheCreationInputTokens,
    },
  );

  return NextResponse.json({
    ok: true,
    messageId: stored.id,
    content: draft.text,
    usage: draft.usage,
  });
}
