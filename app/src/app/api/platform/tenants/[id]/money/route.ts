import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guardPlatform } from "@/lib/platform/auth";
import { recordAudit, requestIp } from "@/lib/platform/audit";
import {
  addCredit,
  cancelCredit,
  getPriceOverrideCents,
  listCredits,
  outstandingCreditCents,
  refundInvoice,
  setPriceOverride,
  statementCsv,
  type MoneyResult,
} from "@/lib/billing/adjustments";
import { getMonthlyPriceCents } from "@/lib/billing/settings";

export const dynamic = "force-dynamic";

/**
 * The money decisions the automatic run cannot make: a negotiated price, a
 * credit, a refund, and a statement to send an accountant.
 *
 * Every write here is OWNER-ONLY. Each one either moves money the wrong way
 * or changes what a business pays every month from now on, and that is the
 * line the two roles were drawn on.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const tenantId = Number(params.id);
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    return NextResponse.json({ error: "Unknown business" }, { status: 404 });
  }

  // A statement is a file, not a page: hand it over as CSV when asked.
  if (req.nextUrl.searchParams.get("statement") === "csv") {
    return new NextResponse(statementCsv(tenantId), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="statement-${tenantId}.csv"`,
      },
    });
  }

  return NextResponse.json({
    priceOverrideCents: getPriceOverrideCents(tenantId),
    platformPriceCents: getMonthlyPriceCents(),
    credits: listCredits(tenantId),
    outstandingCreditCents: outstandingCreditCents(tenantId),
  });
}

const bodySchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set-price"), cents: z.number().int().min(0).max(1_000_000).nullable() }),
  z.object({
    op: z.literal("add-credit"),
    cents: z.number().int().positive().max(1_000_000),
    description: z.string().min(1).max(200),
    reason: z.string().max(300).default(""),
  }),
  z.object({ op: z.literal("cancel-credit"), creditId: z.number().int().positive() }),
  z.object({ op: z.literal("refund"), invoiceId: z.number().int().positive(), reason: z.string().min(3).max(300) }),
]);

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const tenantId = Number(params.id);
  const ip = requestIp(req);

  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "That request does not make sense." }, { status: 400 });
  }

  const action = `money.${parsed.op}`;
  const actor = `admin:${g.userId}`;

  if (g.role !== "owner") {
    recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId, action, ip, ok: false, error: "not an owner" });
    return NextResponse.json({ ok: false, error: "Changing what a business pays is an owner's action." }, { status: 403 });
  }

  let result: MoneyResult;
  let detail: Record<string, unknown>;
  let reason: string | null = null;

  switch (parsed.op) {
    case "set-price":
      detail = { cents: parsed.cents };
      result = setPriceOverride(tenantId, parsed.cents, actor);
      break;
    case "add-credit":
      detail = { cents: parsed.cents, description: parsed.description };
      reason = parsed.reason || null;
      result = addCredit(tenantId, { cents: parsed.cents, description: parsed.description, reason: parsed.reason }, actor);
      break;
    case "cancel-credit":
      detail = { creditId: parsed.creditId };
      result = cancelCredit(parsed.creditId, actor);
      break;
    case "refund":
      detail = { invoiceId: parsed.invoiceId };
      reason = parsed.reason;
      result = refundInvoice(parsed.invoiceId, parsed.reason, actor);
      break;
  }

  recordAudit({
    actorUserId: g.userId,
    actorEmail: g.email,
    actorRole: g.role,
    tenantId,
    action,
    detail,
    reason,
    ip,
    ok: result.ok,
    error: result.ok ? null : result.error,
  });
  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({
    ok: true,
    note: result.note,
    priceOverrideCents: getPriceOverrideCents(tenantId),
    credits: listCredits(tenantId),
    outstandingCreditCents: outstandingCreditCents(tenantId),
  });
}
