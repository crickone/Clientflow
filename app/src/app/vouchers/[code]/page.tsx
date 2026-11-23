import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Mail, Ticket } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { RevealCard } from "@/components/vouchers/RevealCard";
import { VoucherDeliveryActions } from "@/components/vouchers/VoucherDeliveryActions";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getCurrentTenant } from "@/lib/db/tenant";
import { formatDate } from "@/lib/utils";
import {
  balanceLabel,
  colourways,
  deliveryStatus,
  dublinDate,
  formatEuro,
  formatLongDate,
  parseColourway,
  voucherState,
  voucherTitle,
} from "@/lib/vouchers/model";
import { brandPaletteForTenant, getVoucherByCode, listRedemptions, orderForVoucher, therapyName } from "@/lib/vouchers/store";
import { CopyButton } from "./CopyButton";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ code: string }>;
}

const STATE_BADGE = {
  active: { label: "Active", tone: "green" },
  part_used: { label: "Part used", tone: "amber" },
  used: { label: "Used", tone: "green" },
  expired: { label: "Past its date", tone: "amber" },
  cancelled: { label: "Cancelled", tone: "red" },
} as const;

/** A malformed %-escape in the URL is a missing voucher, not a crash. */
function decodeCode(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * One voucher, for staff: the card as the recipient sees it (in this
 * business's colours, never another's), its balance and every use, and for
 * an online voucher the order and its email, with Resend.
 */
export default async function VoucherDetailPage(props: Props) {
  const params = await props.params;
  const code = decodeCode(params.code);
  const v = code === null ? null : getVoucherByCode(code);
  if (!v) notFound();
  const tenantId = getCurrentTenant().id;
  const business = getBusinessProfile();
  const order = orderForVoucher(v);
  const therapy = therapyName(v.therapyId);
  const colourway = parseColourway(v.colourway) ?? colourways(brandPaletteForTenant(tenantId))[0]!;
  const uses = listRedemptions(v.id);
  const state = voucherState(v, dublinDate(Date.now()));
  const title = voucherTitle({ kind: v.kind, valueEur: v.valueEur, therapyName: therapy });
  const delivery = order ? deliveryStatus(order) : null;
  const giftUrl = order && v.viewToken ? `${order.siteUrl}/v/${v.viewToken}` : null;
  const usable = state !== "used" && state !== "cancelled";
  const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 16, padding: "10px 0", borderBottom: "1px solid var(--hairline)", fontSize: 14 };
  const key: React.CSSProperties = { color: "var(--text-tertiary)" };

  return (
    <div className="app-page" style={{ maxWidth: 1000 }}>
      <PageHeader
        eyebrow="Vouchers"
        title={v.code}
        subtitle={v.source === "online" ? `Bought online by ${order?.buyerName ?? v.purchaserName}` : "Made at the desk"}
        actions={
          usable ? (
            <Link href={`/appointments/new?voucher=${encodeURIComponent(v.code)}`}>
              <Button>
                <Ticket size={15} />
                Redeem at a booking
              </Button>
            </Link>
          ) : null
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <RevealCard
            colourway={colourway}
            businessName={business.businessName}
            title={title}
            forName={v.recipientName || "the recipient"}
            code={v.code}
            expiryLabel={`Valid until ${formatLongDate(v.expiryDate)}`}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            <CopyButton code={v.code} />
            <a href={`/vouchers/${encodeURIComponent(v.code)}/email`} target="_blank" rel="noreferrer">
              <Button variant="secondary" size="sm">
                <Mail size={14} />
                See the gift email
              </Button>
            </a>
            {giftUrl && (
              <a href={giftUrl} target="_blank" rel="noreferrer">
                <Button variant="secondary" size="sm">
                  <ExternalLink size={14} />
                  Open the gift page
                </Button>
              </a>
            )}
          </div>
        </div>

        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <CardLabel>Voucher</CardLabel>
            <Badge tone={STATE_BADGE[state].tone}>{STATE_BADGE[state].label}</Badge>
          </div>
          <div style={row}>
            <span style={key}>Type</span>
            <span>{v.kind === "treatment" ? `One ${therapy ?? "treatment"}` : "Money"}</span>
          </div>
          <div style={row}>
            <span style={key}>Value</span>
            <span>{formatEuro(v.valueEur)}</span>
          </div>
          <div style={row}>
            <span style={key}>Left</span>
            <span style={{ fontWeight: 600 }}>{state === "cancelled" ? "Cancelled" : balanceLabel(v)}</span>
          </div>
          <div style={row}>
            <span style={key}>Valid until</span>
            <span>{formatLongDate(v.expiryDate)}</span>
          </div>
          <div style={row}>
            <span style={key}>For</span>
            <span>{v.recipientName ?? "Anyone with the code"}</span>
          </div>
          <div style={row}>
            <span style={key}>From</span>
            <span>{v.purchaserName}</span>
          </div>
          {v.message && (
            <p style={{ margin: "12px 0 0", fontSize: 14, color: "var(--text-secondary)", fontStyle: "italic", lineHeight: 1.6 }}>&ldquo;{v.message}&rdquo;</p>
          )}
          {state === "expired" && (
            <p style={{ margin: "12px 0 0", fontSize: 13, color: "#b45309" }}>This voucher&apos;s date has passed. You can still take it at a booking.</p>
          )}
        </Card>
      </div>

      {order && delivery && (
        <Card style={{ marginTop: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
            <CardLabel>Online order #{order.id}</CardLabel>
            <Badge tone={delivery.tone}>{delivery.label}</Badge>
          </div>
          <div style={row}>
            <span style={key}>Buyer</span>
            <span>
              {order.buyerName} ({order.buyerEmail})
            </span>
          </div>
          <div style={row}>
            <span style={key}>Sent to</span>
            <span>{order.deliverTo === "buyer" ? "The buyer" : `${order.recipientName} (${order.recipientEmail})`}</span>
          </div>
          {order.deliverOn && (
            <div style={row}>
              <span style={key}>Send date</span>
              <span>{formatLongDate(order.deliverOn)}, 9am</span>
            </div>
          )}
          {order.status === "refunded" && state !== "cancelled" && (
            <p style={{ margin: "12px 0 0", fontSize: 13, color: "#dc2626", lineHeight: 1.55 }}>
              Refunded in Stripe after part of it was used. Check it with the buyer before taking it again.
            </p>
          )}
          {order.status === "paid" && (
            <div style={{ marginTop: 16 }}>
              <VoucherDeliveryActions voucherId={v.id} recipientEmail={order.deliverTo === "recipient" ? order.recipientEmail : null} />
            </div>
          )}
        </Card>
      )}

      <Card style={{ marginTop: 20 }}>
        <CardLabel>Uses</CardLabel>
        {uses.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: "var(--text-tertiary)" }}>Not used yet.</p>
        ) : (
          uses.map((u) => (
            <div key={u.id} style={row}>
              <span>
                {formatDate(u.createdAt)}
                {u.appointmentId ? (
                  <>
                    {" · "}
                    <Link href={`/appointments/${u.appointmentId}`} style={{ color: "var(--text-primary)", textDecoration: "underline" }}>
                      booking{u.appointmentDate ? ` on ${u.appointmentDate}` : ""}
                    </Link>
                  </>
                ) : (
                  " · package sale"
                )}
              </span>
              <span style={{ fontWeight: 600 }}>{formatEuro(u.amountEur)}</span>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
