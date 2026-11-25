import { PageHeader } from "@/components/layout/PageHeader";
import { NewBooking } from "@/components/appointments/booking/NewBooking";
import { Card, CardLabel } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { db } from "@/lib/db";
import { clients, giftVouchers, packageTemplates, therapies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { formatDate, formatEur } from "@/lib/utils";
import { getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";
import { dublinDay } from "@/lib/cashModel";
import { blockOutsForDate, dayWindow } from "@/lib/schedule";
import { STRIP_DAYS, blocksCoverDay, dayStrip, stripStart } from "@/lib/booking/slotModel";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ client?: string; date?: string; time?: string; voucher?: string; therapy?: string }>;
}

export default async function NewAppointmentPage(props: Props) {
  const searchParams = await props.searchParams;
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

  // The booking's date (?date=, else today in Dublin) and the 14-day strip it
  // sits in, closed days marked from opening hours and block-outs.
  const today = dublinDay(Date.now());
  const bookDate = searchParams.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date) ? searchParams.date : today;
  const strip = dayStrip(stripStart(today, bookDate, STRIP_DAYS), STRIP_DAYS, (d) => {
    const win = dayWindow(d);
    return win.closed || blocksCoverDay(win.open, win.close, blockOutsForDate(d));
  });

  return (
    <div className="app-page" style={{ maxWidth: 1240 }}>
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

      <NewBooking
        therapies={allTherapies}
        clients={allClients}
        packageTemplates={allTemplates}
        strip={strip}
        defaultClientId={searchParams.client ? Number(searchParams.client) : undefined}
        defaultDate={bookDate}
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
            : searchParams.therapy && Number(searchParams.therapy) > 0
              ? Number(searchParams.therapy)
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
