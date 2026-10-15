"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { requestCancelAction, withdrawCancelAction } from "@/app/app/actions";

/**
 * Give notice to cancel from the app. It records the date, tells the gym and
 * emails the member a copy. While it's open the member can take it back.
 */
export function CancelMembership({ businessName, membershipName, pendingSince }: { businessName: string; membershipName: string; pendingSince: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  if (pendingSince) {
    return (
      <div className="cm cm--sent">
        <b>Cancellation notice sent on {pendingSince}</b>
        <p>{businessName} has your notice and will be in touch to confirm your last payment and the date your membership ends.</p>
        <button
          type="button"
          className="cm-link"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await withdrawCancelAction();
              toast.success("Notice withdrawn. Your membership continues.");
              router.refresh();
            })
          }
        >
          {pending ? "Withdrawing" : "Withdraw my notice"}
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" className="cm-open" onClick={() => setOpen(true)}>
        Cancel my membership
      </button>
    );
  }

  return (
    <div className="cm">
      <b>Cancel {membershipName}</b>
      <p>This sends your written notice to {businessName} today. Check their Terms &amp; Conditions for the notice period. You&rsquo;ll get a copy by email.</p>
      <label className="cm-field">
        <span>Anything you&rsquo;d like them to know? (optional)</span>
        <textarea className="ag-input" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="cm-actions">
        <button
          type="button"
          className="cm-send"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await requestCancelAction(reason);
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              toast.success(r.emailed ? "Notice sent. A copy is on its way to your email." : "Notice sent.");
              setOpen(false);
              router.refresh();
            })
          }
        >
          {pending ? <Loader2 size={16} className="spin" /> : null} Send cancellation notice
        </button>
        <button type="button" className="cm-link" onClick={() => setOpen(false)} disabled={pending}>
          Keep my membership
        </button>
      </div>
    </div>
  );
}
