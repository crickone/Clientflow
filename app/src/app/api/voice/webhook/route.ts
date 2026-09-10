import crypto from "node:crypto";

import { runWithTenant, getTenantDbById } from "@/lib/db/tenant";
import { addMessage } from "@/lib/leads";
import { completeCall, getCall, resolveProviderCall } from "@/lib/voice/calls";
import { meterVoiceCall } from "@/lib/voice/usage";
import { billedMinutesFor } from "@/lib/voice/pricing";
import { transcriptToText, type ConversationDetail } from "@/lib/voice/elevenlabs";
import { completeForLead } from "@/lib/voice/queue";
import { getCallFlowForTenant } from "@/lib/voice/flow";
import { setStageToId } from "@/lib/pipeline/stage";
import { listStagesOnConn } from "@/lib/pipeline/stageRepo";

export const dynamic = "force-dynamic";

/**
 * ElevenLabs' post-call webhook — the read side of lib/voice/dial.ts.
 *
 * A finished conversation arrives here with its duration, transcript and the
 * agent's own summary. This route is what turns that into (a) a completed call
 * record, (b) a line on the lead's timeline, and (c) the meter reading the
 * tenant is actually charged from.
 *
 * Public (see middleware.ts's PUBLIC_API_PREFIXES) but signature-verified —
 * same shape as the Mailgun and WhatsApp webhooks: 200 on any call whose
 * signature verifies (even a no-op) so the provider doesn't retry-storm this
 * endpoint, 401 ONLY for a bad or unverifiable signature.
 *
 * TENANCY: a server-to-server callback with NO session cookie, so it must
 * never touch the ambient request-scoped `db` proxy. The tenant is resolved
 * from `voice_call_index` (written at dial time) via `resolveProviderCall`; an
 * unknown conversation id is IGNORED with a 200 — never a default-tenant
 * shortcut, which would write one tenant's call into another's database.
 *
 * BILLING IS IDEMPOTENT: providers retry webhooks, and this one carries money.
 * `completeCall` is a conditional UPDATE guarded on the row still being
 * 'dialling', and metering happens ONLY if that update won. A redelivered
 * webhook therefore records nothing and charges nothing the second time.
 */

/** The shared secret is per tenant, but the tenant isn't known until the body is parsed — so verification is against every configured secret, constant-time. */
function verifySignature(raw: string, header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  // ElevenLabs sends `t=<unix>,v0=<hex hmac of "t.body">`.
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return i === -1 ? [p, ""] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  ) as Record<string, string>;
  const timestamp = parts.t;
  const provided = parts.v0;
  if (!timestamp || !provided) return false;

  // Reject anything older than 30 minutes: a captured signature must not stay
  // replayable forever, and a real webhook (including their retries) lands
  // well inside that.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 1800) return false;

  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function prop(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export async function POST(req: Request) {
  const raw = await req.text();

  // The webhook secret is a DEPLOYMENT secret, not a per-tenant one: the
  // provider signs with the secret configured on its own webhook, and there is
  // exactly one webhook for the platform's workspace. Per-tenant secrets would
  // require knowing the tenant before verifying, which is backwards.
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET ?? "";
  if (!verifySignature(raw, req.headers.get("elevenlabs-signature"), secret)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Verified but unreadable — nothing to act on, and retrying won't help.
    return Response.json({ ok: true, ignored: "unparseable" });
  }

  // Everything past this point is best-effort: a verified call always gets a
  // 200, so a bad row or a locked DB can't turn into a provider retry storm.
  try {
    const data = (prop(payload, "data") ?? payload) as ConversationDetail;
    const conversationId = str(prop(data, "conversation_id"));
    if (!conversationId) return Response.json({ ok: true, ignored: "no conversation id" });

    const resolved = resolveProviderCall(conversationId);
    if (!resolved) {
      // Not ours, or dialled by a deployment that doesn't share this database.
      // Fail closed: do nothing at all.
      return Response.json({ ok: true, ignored: "unknown conversation" });
    }

    const seconds = Math.max(0, Math.round(Number(data.metadata?.call_duration_secs ?? 0)));
    const transcript = transcriptToText(data);
    const summary = data.analysis?.transcript_summary ?? null;
    const recordingUrl = str(prop(payload, "recording_url")) || null;

    runWithTenant(resolved.tenantId, () => {
      const tdb = getTenantDbById(resolved.tenantId);
      const call = getCall(tdb, resolved.callId);
      if (!call) return;

      // A call that never really happened is 'no_answer', not 'completed' —
      // it reads differently on a timeline, and it is the honest word for it.
      const status = billedMinutesFor(seconds) === 0 ? "no_answer" : "completed";

      // Meter FIRST so the true cost goes onto the record, but claim the row
      // BEFORE metering so a redelivery can't charge twice: completeCall's
      // guarded UPDATE is the claim.
      const claimed = completeCall(tdb, resolved.callId, {
        status,
        durationSeconds: seconds,
        billedMinutes: billedMinutesFor(seconds),
        costCents: 0,
        outcome: summary,
        transcript: transcript || null,
        recordingUrl,
      });
      if (!claimed) return; // already handled — a retry, or a reconciliation beat us to it

      const charge = meterVoiceCall(resolved.tenantId, { seconds, ref: conversationId });
      (tdb as unknown as { $client: import("better-sqlite3").Database }).$client
        .prepare("UPDATE voice_calls SET cost_cents = ?, billed_minutes = ? WHERE id = ?")
        .run(charge.chargedCents, charge.billedMinutes, resolved.callId);

      // A lead who actually answered is finished with the flow: take them off
      // the queue so the retry ladder can't phone someone who has already had
      // the conversation. A no-answer deliberately stays queued — the dialler
      // owns the retry decision, not this route.
      if (call.leadId && status === "completed") {
        completeForLead(tdb, call.leadId);
        const flow = getCallFlowForTenant(resolved.tenantId);
        if (flow.onAnsweredStageRole) {
          try {
            const stage = listStagesOnConn(tdb).find((st) => st.role === flow.onAnsweredStageRole);
            if (stage) setStageToId(call.leadId, stage.id);
          } catch (err) {
            // A stage that has since been renamed or deleted must not cost us
            // the transcript below.
            console.error("[voice webhook] could not advance the lead's stage:", err);
          }
        }
      }

      if (call.leadId) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        const header =
          status === "no_answer"
            ? "Voice agent called — no answer"
            : `Voice agent call — ${mins}m ${secs}s`;
        addMessage({
          leadId: call.leadId,
          direction: "outbound",
          channel: "call",
          aiGenerated: true,
          content: [header, summary ? `Summary: ${summary}` : null, transcript || null]
            .filter(Boolean)
            .join("\n\n"),
          providerMessageId: conversationId,
          status: "delivered",
          sentAt: new Date(),
        });
      }
    });

    return Response.json({ ok: true });
  } catch (err) {
    console.error("[voice webhook] failed to record a completed call:", err);
    return Response.json({ ok: true, ignored: "error" });
  }
}
