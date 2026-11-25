"use client";

import { useState } from "react";

import { useVocab } from "@/components/providers/VocabProvider";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label, Textarea } from "@/components/ui/Input";
import type { NewPackageDraft } from "@/lib/booking/bookingPayload";
import { euro, fullDate } from "@/lib/booking/format";
import type { PaymentChoice, PaymentMethod, UsablePackage } from "@/lib/booking/packageChoiceModel";
import type { SecondaryMethod } from "@/lib/booking/summaryModel";
import type { VoucherCoverage, VoucherInfo } from "@/lib/booking/voucherModel";
import type { PackageTemplate } from "@/lib/db/schema";

import { NewPackagePanel } from "./NewPackagePanel";
import { VoucherPanel } from "./VoucherPanel";
import s from "./booking.module.css";

const METHODS: [Exclude<PaymentMethod, "package">, string][] = [
  ["card", "Card"],
  ["cash", "Cash"],
  ["voucher", "Gift voucher"],
  ["bank_transfer", "Bank transfer"],
];

interface Props {
  choice: PaymentChoice;
  onMethod: (m: PaymentMethod) => void;
  onPackageId: (id: number) => void;
  onSignUp: (signUp: boolean) => void;
  /** The client's packages that can pay for the selected treatment. */
  fits: UsablePackage[];
  therapyId: number | null;
  templates: PackageTemplate[];
  newPackage: NewPackageDraft;
  onNewPackage: (next: NewPackageDraft) => void;
  voucherCode: string;
  onVoucherCode: (code: string) => void;
  voucherInfo: VoucherInfo;
  coverage: VoucherCoverage;
  secondary: SecondaryMethod;
  onSecondary: (m: SecondaryMethod) => void;
  /** The price the booking will send. */
  price: number;
  onPrice: (eur: number) => void;
  duration: number;
  onDuration: (minutes: number) => void;
  /** Set by the package paying: the price field is read-only. */
  priceLocked: boolean;
  notes: string;
  onNotes: (notes: string) => void;
}

/** Card 4: how it is paid, plus the price/length and note behind links. */
export function PaymentCard(p: Props) {
  const vocab = useVocab();
  const plan = vocab.plan.toLowerCase();
  const [adjust, setAdjust] = useState(false);
  const [note, setNote] = useState(Boolean(p.notes));
  const signingUp = p.choice.paymentMethod === "package" && p.choice.packageMode === "new";
  const usingPackage = p.choice.paymentMethod === "package" && p.choice.packageMode === "existing";
  const showPrepaid = p.fits.length > 0 || usingPackage;

  return (
    <Card>
      <CardLabel>Payment</CardLabel>
      <div className={s.chips} role="group" aria-label="Payment method">
        {showPrepaid && (
          <button
            type="button"
            aria-pressed={usingPackage}
            className={`${s.chip} ${usingPackage ? s.chipOn : ""}`}
            onClick={() => p.onMethod("package")}
          >
            Prepaid {plan}
          </button>
        )}
        {METHODS.map(([m, label]) => (
          <button
            key={m}
            type="button"
            aria-pressed={p.choice.paymentMethod === m}
            className={`${s.chip} ${p.choice.paymentMethod === m ? s.chipOn : ""}`}
            onClick={() => p.onMethod(m)}
          >
            {label}
          </button>
        ))}
      </div>

      {usingPackage && p.fits.length > 1 && (
        <div className={s.panel}>
          <div className={s.fieldLabel} style={{ marginBottom: 0 }}>
            Which {plan} pays
          </div>
          <div className={s.stack}>
            {p.fits.map((pkg) => (
              <button
                key={pkg.id}
                type="button"
                aria-pressed={p.choice.packageId === pkg.id}
                className={`${s.option} ${p.choice.packageId === pkg.id ? s.optionOn : ""}`}
                onClick={() => p.onPackageId(pkg.id)}
              >
                <div className={s.optionName}>{pkg.packageName}</div>
                <div className={s.optionSub}>
                  {pkg.available} left to book · {pkg.sessionsUsed}/{pkg.totalSessions} used · use by {fullDate(pkg.expiryDate)}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {signingUp && <NewPackagePanel therapyId={p.therapyId} templates={p.templates} draft={p.newPackage} onDraft={p.onNewPackage} />}

      {p.choice.paymentMethod === "voucher" && (
        <VoucherPanel
          code={p.voucherCode}
          onCode={p.onVoucherCode}
          info={p.voucherInfo}
          coverage={p.coverage}
          price={p.price}
          secondary={p.secondary}
          onSecondary={p.onSecondary}
        />
      )}

      <div className={s.links}>
        <button type="button" className={s.link} onClick={() => p.onSignUp(!signingUp)}>
          {signingUp ? `Cancel the new ${plan}` : `Sign up for a new ${plan}`}
        </button>
        <button type="button" className={s.link} onClick={() => setAdjust((v) => !v)} aria-expanded={adjust}>
          Adjust price or length
        </button>
        {!note && (
          <button type="button" className={s.link} onClick={() => setNote(true)}>
            Add a note
          </button>
        )}
      </div>

      {adjust && (
        <div className={s.fieldGrid} style={{ marginTop: 14 }}>
          <div>
            <label className={s.fieldLabel} htmlFor="booking-duration">
              Length (minutes)
            </label>
            <Input id="booking-duration" type="number" min={0} value={p.duration} onChange={(e) => p.onDuration(Number(e.target.value))} />
          </div>
          <div>
            <label className={s.fieldLabel} htmlFor="booking-price">
              Price (€)
            </label>
            <Input
              id="booking-price"
              type="number"
              step="0.01"
              min={0}
              value={p.price}
              disabled={p.priceLocked}
              onChange={(e) => p.onPrice(Number(e.target.value))}
            />
            {p.priceLocked && (
              <div className={s.optionSub} style={{ marginTop: 6 }}>
                Set by the {plan}: {euro(p.price)} a session.
              </div>
            )}
          </div>
        </div>
      )}

      {note && (
        <div style={{ marginTop: 14 }}>
          <Label htmlFor="booking-notes" srOnly>
            Note
          </Label>
          <Textarea id="booking-notes" placeholder="Anything we should know?" rows={3} value={p.notes} onChange={(e) => p.onNotes(e.target.value)} />
        </div>
      )}
    </Card>
  );
}
