"use client";

import "./chat.css";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import type { CampaignProgress } from "@/components/messaging/campaignProgress";

/**
 * The campaign being built, as a checklist: ticked when done, spinning on the
 * one Adonis is working on, empty for what is next. Shown in the latest
 * exchange's results, so it moves down the chat as work goes on. Moved here
 * unchanged from the old AssistantChat.
 */
export function CampaignChecklist({
  progress,
  working,
  onBuildRest,
}: {
  progress: CampaignProgress;
  working: boolean;
  /** Finish a part-built campaign on the server without stopping (shown when nothing is running). */
  onBuildRest?: () => void;
}) {
  const done = progress.assets.filter((a) => a.status === "done").length;
  const total = progress.assets.length;
  const finished = done === total;
  return (
    <div className="ai-tasks" role="status" aria-label={`${progress.name}: ${done} of ${total} done`}>
      <div className="ai-tasks-head">
        <span className="ai-tasks-name">{progress.name}</span>
        <span className="ai-tasks-count">{finished ? "All done" : `${done} of ${total} done`}</span>
      </div>
      <div className="ai-tasks-bar" aria-hidden>
        <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
      <ol className="ai-tasks-list">
        {progress.assets.map((a, idx) => (
          <li key={`${idx}-${a.kind}`} data-status={a.status}>
            <span className="ai-task-icon" aria-hidden>
              {a.status === "done" ? <Check size={12} strokeWidth={3} /> : a.status === "current" && working ? <Loader2 size={13} className="spin" /> : null}
            </span>
            <span className="ai-task-title">{a.title}</span>
            {a.status === "current" && <span className="ai-task-now">{working ? "Working on it" : "Next"}</span>}
          </li>
        ))}
      </ol>
      {!finished && !working && onBuildRest && (
        <div className="ai-tasks-foot">
          {/* md, not sm: the small button is 32px and buttons here are at least 36px. */}
          <Button size="md" variant="secondary" onClick={onBuildRest}>
            Build the rest
          </Button>
          <span>Approves each asset as it&rsquo;s written, even if you leave this page. Launching still asks you.</span>
        </div>
      )}
    </div>
  );
}
