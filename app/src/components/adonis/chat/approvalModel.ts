/**
 * What an Approve card can say about a pending write. Pure.
 *
 * Old-and-new pairs come only from writes whose input carries both: a
 * website text edit names the exact text it replaces. Other writes carry the
 * new value only (a budget, a stage), so their card shows the summary alone.
 */

import type { ConvAction } from "@/lib/agents/conversationModel";

export type ActionChange = { from: string; to: string };

const CLIP = 140;
const clip = (s: string) => (s.length > CLIP ? `${s.slice(0, CLIP - 1).trimEnd()}…` : s);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The one campaign plan or asset this card is about, or null (a batch, or any other write). */
export function campaignAction(actions: ConvAction[]): ConvAction | null {
  return actions.length === 1 && (actions[0].name === "create_campaign" || actions[0].name === "approve_campaign_asset") ? actions[0] : null;
}

export function actionChanges(a: ConvAction, max = 4): { changes: ActionChange[]; more: number } {
  const pairs: ActionChange[] = [];
  const add = (from: unknown, to: unknown) => {
    const f = str(from);
    const t = str(to);
    if (f && t) pairs.push({ from: f, to: t });
  };
  if (a.name === "edit_website_text") add(a.input.find, a.input.replace);
  if (a.name === "create_website_page" && Array.isArray(a.input.textChanges)) {
    for (const c of a.input.textChanges as unknown[]) {
      if (c && typeof c === "object") add((c as Record<string, unknown>).find, (c as Record<string, unknown>).replace);
    }
  }
  return {
    changes: pairs.slice(0, max).map((p) => ({ from: clip(p.from), to: clip(p.to) })),
    more: Math.max(0, pairs.length - max),
  };
}
