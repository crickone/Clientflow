import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guardPlatform } from "@/lib/platform/auth";
import {
  chargeOutstanding,
  compMonths,
  markPaid,
  offboardTenant,
  reactivateTenant,
  suspendTenant,
  waiveInvoice,
} from "@/lib/billing/engine";

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
