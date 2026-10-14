/**
 * "Approve and build everything": the rules for what happens after each of
 * Adonis's turns while it builds a campaign on the operator's behalf. Pure,
 * so the server loop (lib/agents/autopilot.ts) and the chat (AssistantChat)
 * share one copy and it can be tested without a model.
 */

/** The only writes "Approve and build everything" approves on the operator's behalf. */
export const AUTOPILOT_TOOLS = new Set(["approve_campaign_asset"]);

/** How many turns one job may take before it hands back. An 11-asset kit needs about 15. */
export const AUTOPILOT_MAX_TURNS = 40;

/** Sent when a "build everything" turn ends without proposing the next step. */
export const AUTOPILOT_NUDGE =
  "[Check from the app: the operator approved every campaign asset in advance, and that turn ended without proposing anything.] If you stopped on purpose because something needs the operator to decide (a draft you aren't happy with, a fact you need), say what in one or two lines and stop; the app hands it back to them. Otherwise: if a campaign asset is drafted but not approved, read its draft and propose approve_campaign_asset for it now; or draft the next asset, wait for and read the draft, then propose its approval in this same turn; or if every asset is approved, call get_campaign, list each in a line and propose launch_campaign.";

export type AutopilotResult = { name: string; ok: boolean; text: string };

/**
 * What the agent is told after an approval runs, so it carries on with the
 * next step instead of the turn simply ending.
 */
export function continuationMessage(results: AutopilotResult[], o: { auto: boolean; autopilot: boolean }): string {
  const lines = results.map((r) => `${r.name}: ${r.ok ? "done" : "failed"}. ${r.text.slice(0, 1200)}`).join("\n");
  return [
    o.auto ? "[Approved automatically: the operator approved every campaign asset in advance.]" : "[The operator approved that and it has run.]",
    lines,
    o.autopilot
      ? "Carry on now with the next campaign asset, without stopping to ask: call draft_campaign_asset and wait for its result, read the draft yourself, then propose approve_campaign_asset for it in a later step of this same turn (never both calls at once). The app approves it for the operator. If the draft isn't good enough, redraft it first. When every asset is approved, call get_campaign and list each asset in a line from what it says (landing page headline, each email subject, each post's caption) so the operator can check them, then propose launch_campaign for them to approve; never schedule, send or publish without them."
      : "Carry on with the next step now, without waiting to be asked. If it needs the operator's approval, propose it. If everything is finished, say so in one line.",
  ].join("\n\n");
}

/** What the agent is told when the operator asks it to finish a campaign that is part built. */
export function resumeMessage(campaign: { id: number; name: string }): string {
  return [
    `[The operator asked you to finish building the campaign "${campaign.name}" (campaignId ${campaign.id}) without stopping. They approve every campaign asset in advance.]`,
    "Call get_campaign for it first. If an asset is drafted but not approved, read the draft and propose approve_campaign_asset for it. Otherwise draft the next pending asset with draft_campaign_asset, wait for and read the draft, then propose its approval in a later step of this same turn (never both calls at once). The app approves it for the operator. When every asset is approved, list each in a line from what get_campaign says and propose launch_campaign for them to approve; never schedule, send or publish without them.",
  ].join("\n\n");
}

/** The campaign a create_campaign result made, or null. */
export function campaignIdFromResult(name: string, text: string): number | null {
  if (name !== "create_campaign") return null;
  try {
    const id = Number((JSON.parse(text) as { campaignId?: unknown }).campaignId);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export type AutopilotDecision = "approve" | "ask" | "nudge" | "finish";

/**
 * After a turn: approve what it proposed (only asset approvals for the
 * campaign this job built), hand a proposal to the operator, remind it once
 * when it stopped without proposing anything, or finish.
 */
export function decideAfterTurn(o: {
  pending: { name: string; input: Record<string, unknown> }[];
  autopilot: boolean;
  campaignId: number | null;
  nudges: number;
}): AutopilotDecision {
  if (o.pending.length > 0) {
    const ours =
      o.autopilot &&
      o.campaignId !== null &&
      o.pending.every((a) => AUTOPILOT_TOOLS.has(a.name) && Number(a.input.campaignId) === o.campaignId);
    return ours ? "approve" : "ask";
  }
  return o.autopilot && o.nudges < 1 ? "nudge" : "finish";
}
