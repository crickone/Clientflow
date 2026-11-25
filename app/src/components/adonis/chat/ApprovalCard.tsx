"use client";

import "./chat.css";
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { AdApprovalPreview } from "@/components/ads/AdApprovalPreview";
import type { ConvMessage } from "@/lib/agents/conversationModel";
import { actionChanges, campaignAction } from "./approvalModel";
import { toolLabel } from "./toolLabels";

type Pending = NonNullable<ConvMessage["pending"]>;

export type ApprovalCardProps = {
  pending: Pending;
  busy: boolean;
  /** Approvals run writes and are admin-only (the route returns 403 otherwise). */
  canApprove: boolean;
  onApprove: () => void;
  /** "Approve and build everything" on a campaign plan. */
  onApproveAll: () => void;
  onCancel: () => void;
  /** "Change it": a campaign card is written again with the tweak; any other card is cancelled and the words sent as a message. */
  onChange: (tweak: string) => void;
};

/**
 * Something Adonis wants to change, waiting for the operator. Nothing has
 * run yet: the write-approval gate holds every write until Approve. Each
 * action shows its summary, old and new text where the write carries both,
 * and a preview of any ad it would save.
 */
export function ApprovalCard({ pending, busy, canApprove, onApprove, onApproveAll, onCancel, onChange }: ApprovalCardProps) {
  const [changing, setChanging] = useState(false);
  const [tweak, setTweak] = useState("");
  const approving = pending.status === "approving";
  const campaign = campaignAction(pending.actions);
  const n = pending.actions.length;
  const canSubmit = !busy && (campaign !== null || tweak.trim().length > 0);

  function submit() {
    if (!canSubmit) return;
    onChange(tweak);
    setChanging(false);
    setTweak("");
  }

  return (
    <section className="ax-appr" data-status={pending.status} aria-label="Waiting for your approval">
      <div className="ax-appr-h">{approving ? "Running what you approved" : "Waiting for your OK, nothing has changed yet"}</div>
      {pending.actions.map((a, i) => {
        const { changes, more } = actionChanges(a);
        return (
          <div className="ax-act" key={`a${i}`}>
            <div className="ax-act-t">{a.summary || toolLabel(a.name)}</div>
            <div className="ax-act-m">{toolLabel(a.name)}</div>
            {changes.map((c, k) => (
              <div className="ax-diff" key={`d${k}`}>
                <s>{c.from}</s> <b>{c.to}</b>
              </div>
            ))}
            {more > 0 && <div className="ax-diff">and {more} more</div>}
          </div>
        );
      })}
      {pending.actions
        .filter((a) => a.name === "draft_ad_campaign" || a.name === "add_ad_to_campaign")
        .map((a, i) => (
          <div className="ax-appr-preview" key={`ad${i}`}>
            <AdApprovalPreview name={a.name} input={a.input} />
          </div>
        ))}
      {changing ? (
        <div className="ax-tweak">
          <input
            autoFocus
            value={tweak}
            onChange={(e) => setTweak(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setChanging(false);
              }
            }}
            placeholder={campaign ? "What should be different? You can leave this empty." : "What should change?"}
            aria-label="What should change"
          />
          <button type="button" className="ax-btn ax-btn--quiet" onClick={() => setChanging(false)}>
            Back
          </button>
          <button type="button" className="ax-btn ax-btn--solid" onClick={submit} disabled={!canSubmit}>
            {campaign ? "Write it again" : "Send"}
          </button>
        </div>
      ) : (
        <div className="ax-appr-f">
          <button type="button" className="ax-btn ax-btn--solid" onClick={onApprove} disabled={!canApprove || approving || busy}>
            {approving && <Loader2 size={14} className="spin" aria-hidden />}
            Approve
          </button>
          {campaign?.name === "create_campaign" && (
            <button
              type="button"
              className="ax-btn"
              onClick={onApproveAll}
              disabled={!canApprove || approving || busy}
              title="Approve the plan and every asset as it is written. Adonis still asks before launching, scheduling or sending anything."
            >
              Approve and build everything
            </button>
          )}
          <button type="button" className="ax-btn" onClick={() => setChanging(true)} disabled={approving || busy}>
            Change it
          </button>
          <button type="button" className="ax-btn ax-btn--quiet" onClick={onCancel} disabled={approving}>
            Cancel
          </button>
          <span className="ax-appr-n">{n === 1 ? "1 change" : `${n} changes`}</span>
        </div>
      )}
      {!canApprove && !approving && <div className="ax-appr-note">Only an admin can approve changes.</div>}
    </section>
  );
}
