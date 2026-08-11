import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guardPlatform } from "@/lib/platform/auth";
import { setTenantVenueType } from "@/lib/platform/queries";
import { grantAdminMembership } from "@/lib/platform/access";
import { createOpenToken } from "@/lib/platform/openToken";
import {
  chargeOutstanding,
  compMonths,
  markPaid,
  offboardTenant,
  reactivateTenant,
  setBillingExempt,
  suspendTenant,
  waiveInvoice,
  logEvent,
} from "@/lib/billing/engine";
import { grantCredits, setMarketingSuspended } from "@/lib/email/credits";

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

  try {
    switch (params.action) {
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
        const b = z.object({ invoiceId: z.number() }).parse(await req.json());
        markPaid(b.invoiceId, actor);
        break;
      }
      case "waive": {
        const b = z.object({ invoiceId: z.number() }).parse(await req.json());
        waiveInvoice(b.invoiceId, actor);
        break;
      }
      case "comp": {
        const b = z.object({ months: z.number().int().min(1).max(12) }).parse(await req.json());
        compMonths(id, b.months, actor);
        break;
      }
      case "venue-type": {
        const b = z.object({ venueType: z.enum(["gym", "clinic"]) }).parse(await req.json());
        setTenantVenueType(id, b.venueType);
        break;
      }
      case "grant-credits": {
        // Positive + capped (max €10,000 in one grant) so a fat-fingered
        // amount can't silently hand out an unbounded balance.
        const b = z
          .object({ cents: z.number().int().positive().max(1_000_000) })
          .parse(await req.json());
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
      case "open": {
        // "Open business": grant the PLATFORM ADMIN'S OWN identity (g.userId —
        // never a fake/owner user) a real, idempotent admin membership in this
        // tenant, audit it, then mint a one-time token the app's public /open
        // route exchanges for a normal login session. Never returns a session
        // or token-minting capability to the client directly — only a URL
        // carrying an opaque, single-use, ≤60s token.
        grantAdminMembership(id, g.userId);
        logEvent(id, "opened_by_admin", null, actor);
        const token = createOpenToken(g.userId, id);
        const appUrl = (process.env.APP_URL ?? "https://app.clientflow.ie").replace(/\/+$/, "");
        return NextResponse.json({ ok: true, url: `${appUrl}/open?token=${token}` });
      }
      case "offboard":
        offboardTenant(id, actor);
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Action failed" },
      { status: 400 },
    );
  }
}
