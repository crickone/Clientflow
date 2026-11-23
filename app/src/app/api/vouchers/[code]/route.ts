import { NextResponse } from "next/server";
import { guard } from "@/lib/api/guard";
import { lookupVoucher } from "@/lib/vouchers/redeem";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, props: { params: Promise<{ code: string }> }) {
  const params = await props.params;
  // Staff-only: without this, a forged cookie resolves to the default tenant and
  // lets anyone enumerate voucher codes + balances. Vouchers are redeemed by
  // staff in person, so this is not a public endpoint.
  const denied = await guard("user");
  if (denied) return denied;

  const v = lookupVoucher(decodeURIComponent(params.code));
  if (!v) return NextResponse.json({ ok: false });
  // An expired voucher is a warning, not a refusal: staff may still take it.
  return NextResponse.json({
    ok: true,
    redeemable: v.state !== "used" && v.state !== "cancelled",
    expired: v.expired,
    empty: v.state === "used",
    cancelled: v.state === "cancelled",
    kind: v.kind,
    therapyId: v.therapyId,
    therapyName: v.therapyName,
    recipientName: v.recipientName,
    purchaserName: v.purchaserName,
    expiryDate: v.expiryDate,
    valueEur: v.valueEur,
    balanceEur: v.balanceEur,
  });
}
