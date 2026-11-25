"use client";

import { useVocab } from "@/components/providers/VocabProvider";
import { Input, Label } from "@/components/ui/Input";
import type { NewPackageDraft } from "@/lib/booking/bookingPayload";
import { euro } from "@/lib/booking/format";
import type { SecondaryMethod } from "@/lib/booking/summaryModel";
import type { PackageTemplate } from "@/lib/db/schema";

import s from "./booking.module.css";

const PAID_BY: [SecondaryMethod, string][] = [
  ["card", "Card"],
  ["cash", "Cash"],
  ["bank_transfer", "Bank transfer"],
];

interface Props {
  therapyId: number | null;
  templates: PackageTemplate[];
  draft: NewPackageDraft;
  onDraft: (next: NewPackageDraft) => void;
}

/** "Sign up for a new package" at booking: a template for this treatment, or a custom package, and how it is paid. */
export function NewPackagePanel({ therapyId, templates, draft, onDraft }: Props) {
  const vocab = useVocab();
  const plan = vocab.plan.toLowerCase();

  if (therapyId == null) {
    return (
      <div className={s.panel}>
        <div className={s.muted}>Pick a {vocab.service.toLowerCase()} first.</div>
      </div>
    );
  }

  const forTherapy = templates.filter((t) => t.therapyId === therapyId);

  return (
    <div className={s.panel}>
      <div className={s.stack}>
        {forTherapy.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            aria-pressed={draft.templateId === tpl.id}
            className={`${s.option} ${draft.templateId === tpl.id ? s.optionOn : ""}`}
            onClick={() => onDraft({ ...draft, templateId: tpl.id, name: "" })}
          >
            <div className={s.optionRow}>
              <span className={s.optionName}>{tpl.name}</span>
              <span className={s.muted}>{euro(tpl.priceEur)}</span>
            </div>
            <div className={s.optionSub}>
              {tpl.totalSessions} sessions · valid {tpl.validityMonths} months
            </div>
          </button>
        ))}
        <button
          type="button"
          aria-pressed={draft.templateId == null}
          className={`${s.option} ${draft.templateId == null ? s.optionOn : ""}`}
          onClick={() => onDraft({ ...draft, templateId: null })}
        >
          Custom {plan}
        </button>
      </div>

      {draft.templateId == null && (
        <div className={s.fieldGrid}>
          <div className={s.full}>
            <Label htmlFor="newPkgName" srOnly>
              {vocab.plan} name
            </Label>
            <Input id="newPkgName" placeholder={`${vocab.plan} name`} value={draft.name} onChange={(e) => onDraft({ ...draft, name: e.target.value })} />
          </div>
          <div>
            <label className={s.fieldLabel} htmlFor="newPkgSessions">
              Sessions
            </label>
            <Input
              id="newPkgSessions"
              type="number"
              min={1}
              value={draft.sessions}
              onChange={(e) => onDraft({ ...draft, sessions: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className={s.fieldLabel} htmlFor="newPkgPrice">
              Price (€)
            </label>
            <Input
              id="newPkgPrice"
              type="number"
              step="0.01"
              min={0}
              value={draft.priceEur}
              onChange={(e) => onDraft({ ...draft, priceEur: Number(e.target.value) })}
            />
          </div>
          <div className={s.full}>
            <label className={s.fieldLabel} htmlFor="newPkgExpiry">
              Expiry
            </label>
            <Input id="newPkgExpiry" type="date" value={draft.expiry} onChange={(e) => onDraft({ ...draft, expiry: e.target.value })} />
          </div>
        </div>
      )}

      <div>
        <div className={s.fieldLabel}>{vocab.plan} paid by</div>
        <div className={s.chips}>
          {PAID_BY.map(([m, label]) => (
            <button
              key={m}
              type="button"
              aria-pressed={draft.paymentMethod === m}
              className={`${s.chip} ${s.chipSm} ${draft.paymentMethod === m ? s.chipOn : ""}`}
              onClick={() => onDraft({ ...draft, paymentMethod: m })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={s.optionSub} style={{ marginTop: 8 }}>
          The session is covered by the {plan} (€0). The {plan} price is recorded as the sale.
        </div>
      </div>
    </div>
  );
}
