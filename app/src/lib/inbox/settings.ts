import "server-only";

import { readKey, setKey } from "@/lib/settings";
import type { TriageCategory } from "@/lib/ai/triageMessage";

export interface InboxAiSettings {
  /** Master switch. Off by default — auto-reply only sends once the operator enables it. */
  autoReplyEnabled: boolean;
  /** Categories eligible for auto-send (subset of faq/new_lead). */
  autoReplyCategories: TriageCategory[];
  /** Minimum AI confidence (0-1) to auto-send instead of drafting. */
  autoReplyConfidenceThreshold: number;
}

export const INBOX_AI_DEFAULTS: InboxAiSettings = {
  autoReplyEnabled: false,
  autoReplyCategories: ["faq", "new_lead"],
  autoReplyConfidenceThreshold: 0.8,
};

export function getInboxAiSettings(): InboxAiSettings {
  return {
    autoReplyEnabled: Boolean(
      readKey("auto_reply_enabled", INBOX_AI_DEFAULTS.autoReplyEnabled),
    ),
    autoReplyCategories: readKey(
      "auto_reply_categories",
      INBOX_AI_DEFAULTS.autoReplyCategories,
    ),
    autoReplyConfidenceThreshold: Number(
      readKey(
        "auto_reply_confidence_threshold",
        INBOX_AI_DEFAULTS.autoReplyConfidenceThreshold,
      ),
    ),
  };
}

export function setInboxAiSettings(s: InboxAiSettings): void {
  setKey("auto_reply_enabled", s.autoReplyEnabled);
  setKey("auto_reply_categories", s.autoReplyCategories);
  setKey("auto_reply_confidence_threshold", s.autoReplyConfidenceThreshold);
}
