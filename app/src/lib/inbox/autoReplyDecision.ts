import type { TriageResult } from "../ai/triageMessage";
import type { InboxAiSettings } from "./settings";

export type AutoReplyDecision = "auto_send" | "draft" | "held";

/**
 * The confidence gate. Pure — no I/O, type-only imports — so it can be
 * unit-tested in isolation. Returns whether an auto-reply should send, be
 * drafted for approval, or be held for a human. ALL conditions must hold to
 * auto-send; sensitive always wins (held); anything else defaults to a draft.
 */
export function decideAutoReply(
  triage: Pick<
    TriageResult,
    "category" | "confidence" | "sensitive" | "autoReplyEligible" | "suggestedReply"
  >,
  settings: InboxAiSettings,
  briefComplete: boolean,
): AutoReplyDecision {
  if (triage.sensitive) return "held";
  if (!briefComplete) return "draft";
  if (!settings.autoReplyEnabled) return "draft";
  if (!settings.autoReplyCategories.includes(triage.category)) return "draft";
  if (!triage.autoReplyEligible) return "draft";
  if (triage.confidence < settings.autoReplyConfidenceThreshold) return "draft";
  if (!triage.suggestedReply) return "draft";
  return "auto_send";
}
