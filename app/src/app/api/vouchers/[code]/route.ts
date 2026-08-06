import { NextResponse } from "next/server";
import { getVoucherByCode } from "@/lib/queries";
import { guard } from "@/lib/api/guard";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { code: string } },
) {
  // Staff-only: without this, a forged cookie resolves to the default tenant and
  // lets anyone enumerate voucher codes + balances. Vouchers are redeemed by
  // staff in person, so this is not a public endpoint.
  const denied = await guard("user");
  if (denied) return denied;

  const voucher = await getVoucherByCode(params.code);
  if (!voucher) return NextResponse.json({ ok: false });
  const today = new Date().toISOString().slice(0, 10);
  const expired = voucher.expiryDate < today;
  const empty = (voucher.balanceEur ?? 0) <= 0;
  return NextResponse.json({
    ok: true,
    redeemable: !expired && !empty,
    expired,
    empty,
    valueEur: voucher.valueEur,
    balanceEur: voucher.balanceEur ?? voucher.valueEur,
  });
}
