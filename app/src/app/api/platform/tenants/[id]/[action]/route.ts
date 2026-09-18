import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guardPlatform } from "@/lib/platform/auth";
import { canDo, requiresReason } from "@/lib/platform/roles";
import { archiveTenant, purgeTenant, restoreTenant } from "@/lib/platform/lifecycle";
import { recordAudit, requestIp } from "@/lib/platform/audit";
import { setTenantVenueType } from "@/lib/platform/queries";
import { grantAdminMembership } from "@/lib/platform/access";
import { createOpenToken } from "@/lib/platform/openToken";
import {
  chargeOutstanding,
  compMonths,
  markPaid,
  reactivateTenant,
  setBillingExempt,
  suspendTenant,
  waiveInvoice,
  logEvent,
} from "@/lib/billing/engine";
import { grantCredits, setMarketingSuspended } from "@/lib/email/credits";
import { grantAiCredits, setAiSuspended } from "@/lib/ai/creditsLedger";
import { clearTenantIncludedSends, setTenantIncludedSends } from "@/lib/email/included";
import { ADDON_KEYS, isAddonKey, setAddonStatus, type AddonKey } from "@/lib/billing/addons";
import { grantVoiceCredits, setVoiceSuspended } from "@/lib/voice/credits";
import { setVoiceCapCents } from "@/lib/voice/usage";

export const dynamic = "force-dynamic";

/** Per-tenant billing actions. Body varies by action; all audited via `actor`. */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; action: string } },
) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const actor = `admin:${g.userId}`;
  const id = Number(params.id);
  const action = params.action;
  const ip = requestIp(req);

  // The body is read ONCE here and handed to each case below: a Request's
  // body is a stream that cannot be read twice, and both the role gate and
  // the audit row need to see it before the case does.
  let body: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw.trim()) body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Body must be valid JSON." }, { status: 400 });
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  /** Audit, then refuse -- so no exit path can skip the record. */
  const refuse = (error: string, status: number) => {
    recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId: id, action, detail: redact(body), reason: reason || null, ip, ok: false, error });
    return NextResponse.json({ ok: false, error }, { status });
  };

  // Enforced HERE, in the API, not by hiding a button: a manager who crafts
  // the request by hand is refused exactly as they are in the console.
  if (!canDo(g.role, action)) return refuse("That action is for owners only.", 403);
  if (requiresReason(action) && reason.length < 3) {
    return refuse("A short reason is required for this action.", 400);
  }

  try {
    switch (action) {
      case "suspend":
        suspendTenant(id, actor);
        break;
      case "reactivate":
        reactivateTenant(id, actor);
        break;
      case "exempt":
        setBillingExempt(id, true, actor);
        break;
      case "unexempt":
        setBillingExempt(id, false, actor);
        break;
      case "charge-now": {
        const r = await chargeOutstanding(id, actor);
        if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
        break;
      }
      case "mark-paid": {
        const b = z.object({ invoiceId: z.number() }).parse(body);
        markPaid(b.invoiceId, actor);
        break;
      }
      case "waive": {
        const b = z.object({ invoiceId: z.number() }).parse(body);
        waiveInvoice(b.invoiceId, actor);
        break;
      }
      case "comp": {
        const b = z.object({ months: z.number().int().min(1).max(12) }).parse(body);
        compMonths(id, b.months, actor);
        break;
      }
      case "venue-type": {
        const b = z.object({ venueType: z.enum(["gym", "clinic"]) }).parse(body);
        setTenantVenueType(id, b.venueType);
        break;
      }
      case "grant-credits": {
        // Positive + capped (max €10,000 in one grant) so a fat-fingered
        // amount can't silently hand out an unbounded balance.
        const b = z
          .object({ cents: z.number().int().positive().max(1_000_000) })
          .parse(body);
        grantCredits(id, b.cents, actor);
        logEvent(id, "email_credits_granted", { cents: b.cents }, actor);
        break;
      }
      case "suspend-marketing":
        setMarketingSuspended(id, true, actor);
        logEvent(id, "marketing_suspended", null, actor);
        break;
      case "resume-marketing":
        setMarketingSuspended(id, false, actor);
        logEvent(id, "marketing_resumed", null, actor);
        break;
      case "grant-ai-credits": {
        // Same shape/guard as grant-credits: positive + capped (max €10,000 in
        // one grant) so a fat-fingered amount can't hand out an unbounded balance.
        const b = z
          .object({ cents: z.number().int().positive().max(1_000_000) })
          .parse(body);
        grantAiCredits(id, b.cents, actor);
        logEvent(id, "ai_credits_granted", { cents: b.cents }, actor);
        break;
      }
      case "addon": {
        // The add-on state machine, straight through: 'trial' (entitled, not
        // invoiced), 'active' (entitled + invoiced) or 'cancelled'. An
        // explicit priceCents is a negotiated deal; omitted, the tenant keeps
        // whatever price they already had, else the catalog default.
        const b = z
          .object({
            key: z.string().refine(isAddonKey, { message: `Unknown add-on (expected one of: ${ADDON_KEYS.join(", ")})` }),
            status: z.enum(["trial", "active", "cancelled"]),
            priceCents: z.number().int().min(0).max(100_000).optional(),
          })
          .parse(body);
        const saved = setAddonStatus(id, b.key as AddonKey, b.status, { priceCents: b.priceCents });
        logEvent(id, "addon_changed", { key: b.key, status: b.status, priceCents: saved.priceCents }, actor);
        break;
      }
      case "grant-voice-credits": {
        // Same shape/guard as the other two grants: positive + capped at
        // €10,000 in one go, so a fat-fingered amount can't hand out an
        // unbounded balance.
        const b = z
          .object({ cents: z.number().int().positive().max(1_000_000) })
          .parse(body);
        grantVoiceCredits(id, b.cents, actor);
        logEvent(id, "voice_credits_granted", { cents: b.cents }, actor);
        break;
      }
      case "voice-cap": {
        const b = z.object({ capCents: z.number().int().min(0).max(500_000) }).parse(body);
        setVoiceCapCents(id, b.capCents);
        logEvent(id, "voice_cap_changed", { capCents: b.capCents }, actor);
        break;
      }
      case "suspend-voice":
        setVoiceSuspended(id, true, actor);
        logEvent(id, "voice_suspended", null, actor);
        break;
      case "resume-voice":
        setVoiceSuspended(id, false, actor);
        logEvent(id, "voice_resumed", null, actor);
        break;
      case "email-included": {
        // `null` clears the per-tenant override, returning them to the global
        // allowance — distinct from setting it to 0, which is a deliberate
        // "this tenant gets nothing included".
        const b = z
          .object({ includedSends: z.number().int().min(0).max(1_000_000).nullable() })
          .parse(body);
        if (b.includedSends === null) clearTenantIncludedSends(id);
        else setTenantIncludedSends(id, b.includedSends);
        logEvent(id, "email_included_changed", { includedSends: b.includedSends }, actor);
        break;
      }
      case "suspend-ai":
        setAiSuspended(id, true, actor);
        logEvent(id, "ai_suspended", null, actor);
        break;
      case "resume-ai":
        setAiSuspended(id, false, actor);
        logEvent(id, "ai_resumed", null, actor);
        break;
      case "open": {
        // "Open business": grant the PLATFORM ADMIN'S OWN identity (g.userId —
        // never a fake/owner user) a real, idempotent admin membership in this
        // tenant, audit it, then mint a one-time token the app's public /open
        // route exchanges for a normal login session. Never returns a session
        // or token-minting capability to the client directly — only a URL
        // carrying an opaque, single-use, ≤60s token.
        grantAdminMembership(id, g.userId);
        logEvent(id, "opened_by_admin", { reason }, actor);
        recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId: id, action, detail: null, reason, ip });
        const token = createOpenToken(g.userId, id, reason);
        const appUrl = (process.env.APP_URL ?? "https://app.adonisagent.ie").replace(/\/+$/, "");
        return NextResponse.json({ ok: true, url: `${appUrl}/open?token=${token}` });
      }
      // "Offboard" ARCHIVES (Platform Console v2, slice 6): logins close,
      // the site stops serving, nothing is charged, every byte stays. The
      // 30-day purge job, or an owner's explicit purge-now, does the
      // deleting -- both through offboardTenant, which still takes the
      // backup first.
      case "offboard": {
        const r = archiveTenant(id, actor, reason);
        if (!r.ok) return refuse(r.error, 400);
        break;
      }
      case "restore": {
        const r = restoreTenant(id, actor);
        if (!r.ok) return refuse(r.error, 400);
        break;
      }
      case "purge-now": {
        const r = purgeTenant(id, actor);
        if (!r.ok) return refuse(r.error, 400);
        break;
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 404 });
    }
    recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId: id, action, detail: redact(body), reason: reason || null, ip });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Action failed";
    recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId: id, action, detail: redact(body), reason: reason || null, ip, ok: false, error: message });
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

/**
 * What of the request body goes into the audit row. The console sends no
 * secret through this route today, and an audit log is exactly the wrong
 * place to start keeping one, so anything shaped like a credential is
 * dropped rather than trusted never to appear.
 */
const SECRET_KEYS = /token|secret|password|key$/i;
function redact(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === "reason") continue; // kept in its own column
    out[k] = SECRET_KEYS.test(k) ? "[redacted]" : v;
  }
  return out;
}
