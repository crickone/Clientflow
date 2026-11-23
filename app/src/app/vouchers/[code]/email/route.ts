import { NextResponse } from "next/server";

import { guard } from "@/lib/api/guard";
import { getCurrentTenant } from "@/lib/db/tenant";
import { renderGiftEmail, voucherBrand } from "@/lib/vouchers/email";
import { colourways, parseColourway, voucherTitle } from "@/lib/vouchers/model";
import { brandPaletteForTenant, getVoucherByCode, orderForVoucher, therapyName } from "@/lib/vouchers/store";

export const dynamic = "force-dynamic";

/**
 * Staff preview of a voucher's gift email, exactly as the recipient gets it:
 * this business's name, logo and colours (lib/vouchers/email).
 */
export async function GET(_request: Request, props: { params: Promise<{ code: string }> }) {
  const denied = await guard("user");
  if (denied) return denied;
  const params = await props.params;
  const v = getVoucherByCode(decodeURIComponent(params.code));
  if (!v) return new NextResponse("Voucher not found", { status: 404 });
  const tenantId = getCurrentTenant().id;
  const order = orderForVoucher(v);
  const { html } = renderGiftEmail({
    brand: voucherBrand(tenantId, order?.siteId ?? null, order?.siteUrl ?? null),
    colourway: parseColourway(v.colourway) ?? colourways(brandPaletteForTenant(tenantId))[0]!,
    fromName: v.purchaserName,
    toName: v.recipientName || "you",
    message: v.message,
    title: voucherTitle({ kind: v.kind, valueEur: v.valueEur, therapyName: therapyName(v.therapyId) }),
    code: v.code,
    expiry: v.expiryDate,
    revealUrl: order && v.viewToken ? `${order.siteUrl}/v/${v.viewToken}` : "#",
  });
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
