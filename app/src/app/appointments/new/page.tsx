import { PageHeader } from "@/components/layout/PageHeader";
import { BookingForm } from "@/components/appointments/BookingForm";
import { Card, CardLabel } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { db } from "@/lib/db";
import { clients, giftVouchers, packageTemplates, therapies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { formatDate, formatEur } from "@/lib/utils";
import { getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: { client?: string; date?: string; time?: string; voucher?: string };
}

export default async function NewAppointmentPage({ searchParams }: Props) {
  const vocab = getVocab(getVenueType());
  const allTherapies = db
    .select()
    .from(therapies)
    .where(eq(therapies.isActive, true))
    .all();
  const allClients = db.select().from(clients).all();
  const allTemplates = db
    .select()
    .from(packageTemplates)
    .where(eq(packageTemplates.isActive, true))
    .all();

  // If a voucher code is in the URL, look it up so we can show a preview
  // banner and pre-fill the booking form's payment + therapy fields.
  const voucher = searchParams.voucher
    ? db
        .select()
        .from(giftVouchers)
        .where(eq(giftVouchers.code, searchParams.voucher))
        .get()
    : null;

  return (
    <div className="app-page" style={{ maxWidth: 880 }}>
      <PageHeader
        eyebrow={voucher ? "Voucher redemption" : "Schedule"}
        title={voucher ? "Redeem voucher" : `New ${vocab.booking.toLowerCase()}`}
        subtitle={
          voucher
            ? `Code ${voucher.code} · purchased by ${voucher.purchaserName}`
            : undefined
        }
      />

      {voucher && (
        <Card style={{ marginBottom: 24 }}>
          <CardLabel>Voucher details</CardLabel>
          {(() => {
            const balance = voucher.balanceEur ?? voucher.valueEur;
            const empty = balance <= 0.01;
            const expired =
              voucher.expiryDate < new Date().toISOString().slice(0, 10);
            const partiallyUsed =
              balance > 0.01 && balance < voucher.valueEur - 0.01;
            return (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: 16,
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ color: "var(--text-tertiary)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                    Balance
                  </div>
                  <div
                    style={{
                      color: empty ? "var(--text-tertiary)" : "var(--text-primary)",
                      fontWeight: 600,
                      fontFamily: "var(--font-heading)",
                      fontSize: 22,
                    }}
                  >
                    {formatEur(balance)}
                  </div>
                  {partiallyUsed && (
                    <div style={{ color: "var(--text-tertiary)", fontSize: 11, marginTop: 2 }}>
                      of {formatEur(voucher.valueEur)} original
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ color: "var(--text-tertiary)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                    Recipient
                  </div>
                  <div style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                    {voucher.recipientName ?? "—"}
                  </div>
                </div>
                <div>
                  <div style={{ color: "var(--text-tertiary)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                    Expiry
                  </div>
                  <div style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                    {formatDate(voucher.expiryDate)}
                  </div>
                </div>
                <div>
                  <div style={{ color: "var(--text-tertiary)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                    Status
                  </div>
                  {empty ? (
                    <Badge tone="green">Fully redeemed</Badge>
                  ) : expired ? (
                    <Badge tone="red">Expired</Badge>
                  ) : partiallyUsed ? (
                    <Badge tone="amber">Partial — ready</Badge>
                  ) : (
                    <Badge tone="green">Ready to redeem</Badge>
                  )}
                </div>
              </div>
            );
          })()}
        </Card>
      )}

      <BookingForm
        therapies={allTherapies}
        clients={allClients}
        packageTemplates={allTemplates}
        defaultClientId={searchParams.client ? Number(searchParams.client) : undefined}
        defaultDate={searchParams.date}
        defaultStartTime={searchParams.time}
        defaultVoucherCode={
          voucher && (voucher.balanceEur ?? voucher.valueEur) > 0
            ? voucher.code
            : undefined
        }
        defaultTherapyId={
          voucher &&
          voucher.therapyId &&
          (voucher.balanceEur ?? voucher.valueEur) > 0
            ? voucher.therapyId
            : undefined
        }
        defaultWalkInName={
          voucher &&
          voucher.recipientName &&
          (voucher.balanceEur ?? voucher.valueEur) > 0
            ? voucher.recipientName
            : undefined
        }
      />
    </div>
  );
}
