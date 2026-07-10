import { NextResponse } from "next/server";
import { getVoucherByCode } from "@/lib/queries";
import { renderVoucherEmail } from "@/lib/voucherEmail";

export const dynamic = "force-dynamic";

const DEMO = {
  code: "DEMO-2026-RNV",
  valueEur: 150,
  expiryDate: "2027-05-10",
  purchaserName: "Aoife Murphy",
  recipientName: "Cillian",
  message:
    "For all the late nights and early mornings — go take an hour for yourself. You've earned it." as
      | string
      | null,
  therapyName: null as string | null,
};

export async function GET(
  request: Request,
  { params }: { params: { code: string } },
) {
  const code = decodeURIComponent(params.code);
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  const isDemoCode =
    code.toLowerCase() === "demo" || code.toUpperCase().startsWith("DEMO-");
  let voucher: typeof DEMO;
  if (isDemoCode) {
    voucher = { ...DEMO, code };
  } else {
    const row = await getVoucherByCode(code);
    if (!row) return new NextResponse("Voucher not found", { status: 404 });
    voucher = {
      code: row.code,
      valueEur: row.valueEur,
      expiryDate: row.expiryDate,
      purchaserName: row.purchaserName,
      recipientName: row.recipientName ?? "you",
      message: null,
      therapyName: null,
    };
  }

  const { html } = renderVoucherEmail({ voucher, baseUrl });
  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
