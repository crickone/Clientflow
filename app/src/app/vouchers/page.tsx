import Link from "next/link";
import { Gift, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { VoucherList } from "@/components/vouchers/VoucherList";
import { listVouchers, getTherapyMap } from "@/lib/queries";
import { getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

export default async function VouchersPage() {
  const vocab = getVocab(getVenueType());
  const [vouchers, therapyMap] = await Promise.all([
    listVouchers(),
    getTherapyMap(),
  ]);

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Vouchers"
        title="Gift Vouchers"
        actions={
          <Link href="/vouchers/new">
            <Button>
              <Plus size={15} />
              Create voucher
            </Button>
          </Link>
        }
      />

      <Card
        style={{
          marginBottom: 24,
          background: "var(--surface-1)",
          borderColor: "var(--hairline)",
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: "var(--text-tertiary)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            fontWeight: 500,
            marginBottom: 12,
          }}
        >
          How to handle gift vouchers
        </div>

        <ol
          style={{
            margin: 0,
            paddingLeft: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            counterReset: "vstep",
          }}
        >
          <Step
            n={1}
            title="Selling a voucher"
            body={
              <>
                Click <strong>Create voucher</strong>. Pick the{" "}
                <strong>purchaser</strong> (the person paying — link them as a client or
                enter a guest name + email) and the <strong>recipient</strong> (who the
                voucher is for). Choose a value, optional therapy, and expiry. Hit{" "}
                <strong>Create voucher</strong> — the system generates a unique code.
              </>
            }
          />
          <Step
            n={2}
            title="Writing the physical voucher"
            body={
              <>
                Open the new voucher and write the <strong>code</strong> (e.g.{" "}
                <code style={codeStyle}>RCH-2026-A4F2</code>), the{" "}
                <strong>recipient name</strong>, the <strong>value</strong>, and the{" "}
                <strong>expiry date</strong> on the physical card. Hand it to the
                purchaser.
              </>
            }
          />
          <Step
            n={3}
            title="Recipient vs guest"
            body={
              <>
                If the recipient is linked to a {vocab.member.toLowerCase()} record,{" "}
                <strong>only that {vocab.member.toLowerCase()}</strong>{" "}
                can redeem the voucher. If you used <em>Just a name</em>, anyone with the
                code can redeem it — the first {vocab.member.toLowerCase()} who uses it gets locked in.
              </>
            }
          />
          <Step
            n={4}
            title={`Redeeming on a ${vocab.plan.toLowerCase()}`}
            body={
              <>
                When the customer comes in to buy a {vocab.plan.toLowerCase()}, go to{" "}
                <Link href="/packages/new" style={linkStyle}>
                  {vocab.plans} → Sell {vocab.plan.toLowerCase()}
                </Link>
                . Pick the template and {vocab.member.toLowerCase()}, then enter the voucher code in the
                <strong> Gift voucher</strong> field and hit <strong>Apply</strong>. The
                voucher amount comes off the price; the customer pays the remainder.
              </>
            }
          />
          <Step
            n={5}
            title="Partial use & balance"
            body={
              <>
                If the {vocab.plan.toLowerCase()} costs less than the voucher value, the leftover stays on
                the voucher for next time. Check any voucher&apos;s remaining balance
                from the list below — fully-used vouchers are marked redeemed.
              </>
            }
          />
        </ol>
      </Card>

      {vouchers.length === 0 ? (
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
      ) : (
        <VoucherList vouchers={vouchers} therapyMap={therapyMap} />
      )}
    </div>
  );
}

function Step({
  n,
  title,
  body,
}: {
  n: number;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <li
      style={{
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
      }}
    >
      <span
        style={{
          flexShrink: 0,
          width: 28,
          height: 28,
          borderRadius: "var(--radius)",
          background: "var(--surface-2)",
          border: "1px solid var(--hairline)",
          color: "var(--text-primary)",
          fontSize: 13,
          fontWeight: 500,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {n}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            color: "var(--text-primary)",
            fontSize: 14,
            fontWeight: 500,
            marginBottom: 2,
          }}
        >
          {title}
        </div>
        <div
          style={{
            color: "var(--text-secondary)",
            fontSize: 13,
            lineHeight: 1.55,
          }}
        >
          {body}
        </div>
      </div>
    </li>
  );
}

const codeStyle: React.CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
  padding: "1px 6px",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: 12,
  color: "var(--text-primary)",
};

const linkStyle: React.CSSProperties = {
  color: "var(--text-primary)",
  textDecoration: "underline",
};
