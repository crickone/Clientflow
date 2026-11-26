import Link from "next/link";
import { Gift, Plus, Store } from "lucide-react";
import { gte, sql } from "drizzle-orm";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { VoucherList, type VoucherListRow } from "@/components/vouchers/VoucherList";
import { db, schema } from "@/lib/db";
import { getTherapyMap } from "@/lib/queries";
import { getFeatureFlags, getVenueType } from "@/lib/settings";
import { getCurrentMembership } from "@/lib/auth";
import { isModuleOn } from "@/lib/features";
import { dublinToday } from "@/lib/billing/dates";
import { zonedTimeToUtc } from "@/lib/leadFlows/sendingWindow";
import { listVoucherRows } from "@/lib/vouchers/store";
import { deliveryStatus } from "@/lib/vouchers/model";
import { voucherFigures } from "@/lib/vouchers/listModel";
import { getVocab } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

export default async function VouchersPage() {
  const vocab = getVocab(getVenueType());
  const vouchers = listVoucherRows();
  const therapyMap = await getTherapyMap();
  // Products > Vouchers > Online store: admins, with the voucher_store module on.
  const showStore = getCurrentMembership()?.role === "admin" && isModuleOn(getFeatureFlags(), "voucher_store");

  const today = dublinToday();
  const month = today.slice(0, 7);
  const monthStart = zonedTimeToUtc(`${month}-01`, "00:00");
  const usedThisMonthEur = Number(
    db
      .select({ n: sql<number>`coalesce(sum(${schema.voucherRedemptions.amountEur}), 0)` })
      .from(schema.voucherRedemptions)
      .where(gte(schema.voucherRedemptions.createdAt, monthStart))
      .get()?.n ?? 0,
  );

  const rows: VoucherListRow[] = vouchers.map((v) => {
    const t = v.therapyId ? therapyMap.get(v.therapyId) : null;
    return {
      id: v.id,
      code: v.code,
      valueEur: v.valueEur,
      balanceEur: v.balanceEur,
      expiryDate: v.expiryDate,
      cancelledAt: v.cancelledAt,
      createdAt: v.createdAt.getTime(),
      source: v.source,
      purchaserName: v.purchaserName,
      purchaserEmail: v.purchaserEmail,
      recipientName: v.recipientName,
      buyerName: v.order?.buyerName ?? null,
      recipientEmail: v.order?.recipientEmail ?? null,
      treatment: t ? { name: t.name, colour: t.colourHex } : null,
      delivery: v.order ? deliveryStatus(v.order) : null,
    };
  });
  const figures = voucherFigures(rows, {
    today,
    month,
    monthOf: (ms) => dublinToday(new Date(ms)).slice(0, 7),
    usedThisMonthEur,
  });

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Sales"
        title="Gift vouchers"
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {showStore && (
              <Link href="/vouchers/store">
                <Button variant="secondary">
                  <Store size={15} />
                  Online store
                </Button>
              </Link>
            )}
            <Link href="/vouchers/new">
              <Button>
                <Plus size={15} />
                Create voucher
              </Button>
            </Link>
          </div>
        }
      />

      {vouchers.length === 0 ? (
        <>
          <EmptyState
            icon={<Gift size={32} strokeWidth={1.4} />}
            title="No vouchers yet"
            message={`Create a voucher to gift ${vocab.service.toLowerCase()} sessions or a euro value.`}
            action={
              <Link href="/vouchers/new">
                <Button>
                  <Plus size={15} />
                  Create voucher
                </Button>
              </Link>
            }
          />
          <HowVouchersWork member={vocab.member.toLowerCase()} plan={vocab.plan.toLowerCase()} />
        </>
      ) : (
        <VoucherList
          vouchers={rows}
          figures={figures}
          today={today}
          help={<HowVouchersWork member={vocab.member.toLowerCase()} plan={vocab.plan.toLowerCase()} />}
        />
      )}
    </div>
  );
}

/** The short how-to, closed until asked for. */
function HowVouchersWork({ member, plan }: { member: string; plan: string }) {
  return (
    <details className="vh-help">
      <summary>How vouchers work</summary>
      <ol>
        <li>
          <strong>Sell one.</strong> Create voucher: who is paying, who it is for, a euro value or one treatment, and an expiry. The code is made for you. Vouchers bought in the online store appear here by themselves.
        </li>
        <li>
          <strong>Give it.</strong> Open the voucher to print it or email it, or write the code, the name, the value and the expiry on a card.
        </li>
        <li>
          <strong>Use it.</strong> Press Redeem to book with it, or enter the code in the Gift voucher field when selling a {plan}. The value comes off the price.
        </li>
        <li>
          <strong>What is left stays on it.</strong> A part-used voucher keeps its balance for next time. A voucher for a named {member} can only be used by that {member}.
        </li>
      </ol>
    </details>
  );
}
