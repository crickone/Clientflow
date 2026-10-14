"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { setOffersScheduleAction } from "@/app/marketing/campaigns/actions";
import { fromLocalInput, toLocalInput } from "./offerDates";

/** One sale window and use-by date for every offer at once. */
export function OfferScheduleForm({ campaignId, initial, onDone }: { campaignId: number; initial: { starts: number | null; ends: number | null; useBy: string }; onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState({ starts: toLocalInput(initial.starts), ends: toLocalInput(initial.ends), useBy: initial.useBy });
  function save() {
    start(async () => {
      const r = await setOffersScheduleAction(campaignId, { saleStartsAt: fromLocalInput(v.starts), saleEndsAt: fromLocalInput(v.ends), useByDate: v.useBy });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Dates updated on ${r.changed} ${r.changed === 1 ? "offer" : "offers"}`);
      onDone();
      router.refresh();
    });
  }
  return (
    <div className="op-form op-sched-form">
      <label className="op-field">
        <span>On sale from</span>
        <input type="datetime-local" value={v.starts} onChange={(e) => setV({ ...v, starts: e.target.value })} />
        <small>Leave empty to sell as soon as an offer is switched on.</small>
      </label>
      <label className="op-field">
        <span>Until</span>
        <input type="datetime-local" value={v.ends} onChange={(e) => setV({ ...v, ends: e.target.value })} />
        <small>When the prices come off the page.</small>
      </label>
      <label className="op-field">
        <span>Use by</span>
        <input type="date" value={v.useBy} onChange={(e) => setV({ ...v, useBy: e.target.value })} />
        <small>The date buyers must use their sessions by.</small>
      </label>
      <div className="op-form-actions op-wide">
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} loading={pending}>
          Save for all offers
        </Button>
      </div>
    </div>
  );
}
