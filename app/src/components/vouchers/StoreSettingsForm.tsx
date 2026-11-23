"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { saveVoucherStoreAction, type StoreSettingsInput } from "@/app/vouchers/store/actions";
import { MIN_EXPIRY_YEARS, type StoreTreatment } from "@/lib/vouchers/model";

/** The online voucher store's settings. Saved together with one button. */
export function StoreSettingsForm({ initial, therapies }: { initial: StoreSettingsInput; therapies: StoreTreatment[] }) {
  const router = useRouter();
  const [s, setS] = useState<StoreSettingsInput>(initial);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof StoreSettingsInput>(k: K, v: StoreSettingsInput[K]) => setS((prev) => ({ ...prev, [k]: v }));
  const toggleTherapy = (id: number) =>
    set("therapyIds", s.therapyIds.includes(id) ? s.therapyIds.filter((x) => x !== id) : [...s.therapyIds, id]);

  function save() {
    startTransition(async () => {
      const r = await saveVoucherStoreAction(s);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(s.enabled ? "Saved. The store is on." : "Saved. The store is off.");
      router.refresh();
    });
  }

  const check: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--text-primary)", cursor: "pointer", minHeight: 36 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card>
        <label style={check}>
          <input type="checkbox" checked={s.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          Store on: sell gift vouchers at /vouchers on your website
        </label>
      </Card>

      <Card>
        <CardLabel>Money vouchers</CardLabel>
        <Label htmlFor="vs-amounts">Amounts (whole euros, with commas)</Label>
        <Input id="vs-amounts" value={s.amountsText} onChange={(e) => set("amountsText", e.target.value)} placeholder="25, 50, 100" />
        <label style={{ ...check, marginTop: 14 }}>
          <input type="checkbox" checked={s.allowCustom} onChange={(e) => set("allowCustom", e.target.checked)} />
          Buyers can type their own amount
        </label>
        {s.allowCustom && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginTop: 12 }}>
            <div>
              <Label htmlFor="vs-min">Lowest (EUR)</Label>
              <Input id="vs-min" type="number" min={5} step={1} value={s.customMin} onChange={(e) => set("customMin", Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="vs-max">Highest (EUR)</Label>
              <Input id="vs-max" type="number" min={5} step={1} value={s.customMax} onChange={(e) => set("customMax", Number(e.target.value))} />
            </div>
          </div>
        )}
      </Card>

      <Card>
        <CardLabel>Treatment vouchers</CardLabel>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.55 }}>
          One session of a treatment at its list price. The name and price come from your services, so they follow any change you make there.
        </p>
        {therapies.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-tertiary)" }}>No active services with a price yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {therapies.map((t) => (
              <label key={t.id} style={check}>
                <input type="checkbox" checked={s.therapyIds.includes(t.id)} onChange={() => toggleTherapy(t.id)} />
                {t.name}, EUR {t.priceEur.toFixed(2).replace(/\.00$/, "")}
              </label>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardLabel>The store page</CardLabel>
        <Label htmlFor="vs-intro">Intro line (optional, up to 200 characters)</Label>
        <Textarea id="vs-intro" rows={2} maxLength={200} value={s.intro} onChange={(e) => set("intro", e.target.value)} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginTop: 14 }}>
          <div>
            <Label htmlFor="vs-years">Valid for (years, at least {MIN_EXPIRY_YEARS})</Label>
            <Input id="vs-years" type="number" min={MIN_EXPIRY_YEARS} step={1} value={s.expiryYears} onChange={(e) => set("expiryYears", Number(e.target.value))} />
          </div>
          <div>
            <Label htmlFor="vs-book">Booking link (optional)</Label>
            <Input id="vs-book" type="url" placeholder="Blank: your phone number" value={s.bookUrl} onChange={(e) => set("bookUrl", e.target.value)} />
          </div>
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
          Irish law says gift vouchers last at least 5 years.
        </p>
      </Card>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button type="button" onClick={save} loading={pending}>
          Save
        </Button>
      </div>
    </div>
  );
}
