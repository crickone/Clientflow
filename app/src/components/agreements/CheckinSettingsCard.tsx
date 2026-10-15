"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/Card";
import { WEEKDAYS } from "@/lib/memberChoicesModel";
import { saveCheckinSettingsAction } from "@/app/my-app/actions";

/** Staff side of the weekly check-in: the form members fill in and the day it falls due. */
export function CheckinSettingsCard({
  formId,
  weekday,
  choices,
  isAdmin,
}: {
  formId: number | null;
  weekday: number;
  choices: { id: number; title: string; status: boolean }[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function save(next: { formId: number | null; weekday: number }) {
    start(async () => {
      const r = await saveCheckinSettingsAction(next);
      if (!r.ok) toast.error(r.error);
      else toast.success(next.formId ? `Check-ins due every ${WEEKDAYS[next.weekday - 1]}.` : "Check-ins turned off.");
      router.refresh();
    });
  }

  return (
    <Card className="as-card">
      <div className="as-head">
        <span className="as-icon" aria-hidden>
          <ClipboardCheck size={18} />
        </span>
        <div className="as-head-text">
          <b>Weekly check-in</b>
          <span>From the day you pick, members see &ldquo;Check-in due&rdquo; in the app until they send it. Their answers and photos show on their client page.</span>
        </div>
      </div>
      <div className="as-grid2">
        <div className="as-section">
          <label className="as-label" htmlFor="ci-form">
            Check-in form
          </label>
          <select id="ci-form" className="as-select" value={formId ?? ""} disabled={!isAdmin || pending} onChange={(e) => save({ formId: e.target.value ? Number(e.target.value) : null, weekday })}>
            <option value="">Off</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title || `Check-in ${c.id}`}
                {c.status ? "" : " (switched off)"}
              </option>
            ))}
          </select>
        </div>
        <div className="as-section">
          <label className="as-label" htmlFor="ci-day">
            Due every
          </label>
          <select id="ci-day" className="as-select" value={weekday} disabled={!isAdmin || pending} onChange={(e) => save({ formId, weekday: Number(e.target.value) })}>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i + 1}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="as-hint">
        {choices.length === 0 ? "No check-in form yet. " : ""}Build one under <Link href="/forms/checkin">Forms, Check-in</Link>. Photo questions take up to three photos.
      </p>
    </Card>
  );
}
