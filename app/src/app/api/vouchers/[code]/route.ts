import { NextResponse } from "next/server";
import { getVoucherByCode } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { code: string } },
) {
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
