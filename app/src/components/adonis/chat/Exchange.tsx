"use client";

import "./chat.css";
import { Fragment, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Paperclip } from "lucide-react";

import type { LivePhase } from "@/lib/agents/liveEvents";
import { AnswerDocument } from "./AnswerDocument";
import { ApprovalCard } from "./ApprovalCard";
import { FollowUps } from "./FollowUpList";
import { ResultCards } from "./ResultCards";
import { StepsPanel } from "./StepsPanel";
import { firstSentence, showFollowUps, type ChatExchange, type ExchangeReply } from "./exchanges";

export type ExchangeActions = {
  onApprove: (index: number) => void;
  onApproveAll: (index: number) => void;
  onCancel: (index: number) => void;
  onChange: (index: number, tweak: string) => void;
  onFollowUp: (text: string) => void;
};

export type ExchangeProps = {
  exchange: ChatExchange;
  /** Adonis is working on this exchange now. */
  live: boolean;
  phases: Record<number, LivePhase>;
  isLast: boolean;
  /** An earlier exchange shown as one line (question and first sentence). */
  folded: boolean;
  onToggleFold?: () => void;
  busy: boolean;
  canApprove: boolean;
  /** The campaign checklist, on the latest exchange only. */
  campaign?: ReactNode;
  actions: ExchangeActions;
};

type Tab = "answer" | "steps" | "results";

function openCard(r: ExchangeReply): boolean {
  const s = r.message.pending?.status;
  return s === "awaiting" || s === "approving";
}

/**
 * One question and its answer, as a page: the question as a headline, tabs
 * Answer / Steps / Results, the steps panel, the answer as a document, any
 * Approve card under the reply that asked for it, result cards and, on the
 * latest finished exchange, follow-up suggestions.
 */
export function Exchange({ exchange: x, live, phases, isLast, folded, onToggleFold, busy, canApprove, campaign, actions }: ExchangeProps) {
  const [tab, setTab] = useState<Tab>("answer");
  const lastReply = x.replies[x.replies.length - 1];
  const phase: LivePhase | null = live && lastReply ? (phases[lastReply.index] ?? null) : null;
  const cards = x.replies.filter(openCard);
  const resultCount = x.artifacts.length + cards.length + (campaign ? 1 : 0);
  const shownTab: Tab = tab === "results" && resultCount === 0 ? "answer" : tab;

  if (folded) {
    const summary = firstSentence(x.replies.map((r) => r.body).find((b) => b.trim()) ?? "");
    return (
      <div className="ax-ex" data-exchange={x.key}>
        <button type="button" className="ax-fold" onClick={onToggleFold} aria-expanded={false}>
          <b>
            <span>{x.question || "Adonis"}</span>
            <ChevronDown size={15} strokeWidth={1.75} aria-hidden />
          </b>
          {summary || "Open to read the answer."}
        </button>
      </div>
    );
  }

  const card = (r: ExchangeReply) =>
    r.message.pending ? (
      <ApprovalCard
        key={`card${r.index}`}
        pending={r.message.pending}
        busy={busy}
        canApprove={canApprove}
        onApprove={() => actions.onApprove(r.index)}
        onApproveAll={() => actions.onApproveAll(r.index)}
        onCancel={() => actions.onCancel(r.index)}
        onChange={(tweak) => actions.onChange(r.index, tweak)}
      />
    ) : null;

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "answer", label: "Answer" },
    { id: "steps", label: "Steps", count: x.tools.length },
    ...(resultCount > 0 ? [{ id: "results" as const, label: "Results", count: resultCount }] : []),
  ];

  return (
    <div className={isLast ? "ax-ex ax-ex--last" : "ax-ex"} data-exchange={x.key}>
      {x.question && <h2 className="ax-q">{x.question}</h2>}
      {x.attached.length > 0 && (
        <div className="ax-attached">
          {x.attached.map((a) => (
            <span key={a.id} className="ax-chip" title={`${a.name} (${a.kind})`}>
              <Paperclip size={12} strokeWidth={2} aria-hidden />
              <span>{a.name}</span>
            </span>
          ))}
        </div>
      )}
      <div className="ax-tabs" role="tablist" aria-label="Answer views">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${x.key}-tab-${t.id}`}
            aria-controls={`${x.key}-panel`}
            aria-selected={shownTab === t.id}
            className="ax-tab"
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.count !== undefined && <span className="ax-count">{t.count}</span>}
          </button>
        ))}
        {!isLast && onToggleFold && (
          <button type="button" className="ax-tab ax-tab--end" onClick={onToggleFold} aria-expanded>
            Fold
            <ChevronUp size={14} strokeWidth={1.75} aria-hidden />
          </button>
        )}
      </div>
      <div role="tabpanel" id={`${x.key}-panel`} aria-labelledby={`${x.key}-tab-${shownTab}`}>
        {shownTab === "answer" && (
          <>
            <StepsPanel variant="answer" tools={x.tools} live={live} phase={phase} startedAt={x.startedAt} durationMs={x.durationMs} />
            {x.replies.map((r) => (
              <Fragment key={r.index}>
                {r.body && <AnswerDocument text={r.body} streaming={live && r === lastReply} />}
                {openCard(r) && card(r)}
              </Fragment>
            ))}
            <ResultCards artifacts={x.artifacts} campaign={campaign} />
            {showFollowUps({ isLast, live, openCards: cards.length }) && <FollowUps items={x.followups} disabled={busy} onPick={actions.onFollowUp} />}
          </>
        )}
        {shownTab === "steps" && (
          <StepsPanel variant="full" tools={x.tools} live={live} phase={phase} startedAt={x.startedAt} durationMs={x.durationMs} />
        )}
        {shownTab === "results" && (
          <>
            {cards.map((r) => card(r))}
            <ResultCards artifacts={x.artifacts} campaign={campaign} />
          </>
        )}
      </div>
    </div>
  );
}
