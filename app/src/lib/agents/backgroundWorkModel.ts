/**
 * Background work Adonis starts and the server picks back up when it is done
 * (lib/agents/conversation.ts watchAds / followUp). Pure, so the parsing and
 * the hand-back wording are tested without a database or a model.
 */

/** The Content Studio ads that approved create_ad calls started. */
export function adIdsFromResults(results: Array<{ name: string; ok: boolean; text: string }>): number[] {
  const ids: number[] = [];
  for (const r of results) {
    if (r.name !== "create_ad" || !r.ok) continue;
    try {
      const id = Number((JSON.parse(r.text) as { adId?: unknown }).adId);
      if (Number.isInteger(id) && id > 0 && !ids.includes(id)) ids.push(id);
    } catch {
      /* not JSON: an error text, nothing started */
    }
  }
  return ids;
}

export type WatchedAd = { id: number; name: string; status: "writing" | "failed" | null; error: string | null; versions: number } | null;

/**
 * The hidden note that opens Adonis's follow-up turn: what finished, and what
 * to do now. Never asks the operator to check; it hands Adonis the next step.
 */
export function adsFinishedMessage(adIds: number[], ads: WatchedAd[]): string {
  const lines = adIds.map((id, i) => {
    const a = ads[i];
    if (!a) return `Ad #${id} was deleted before it finished.`;
    if (a.status === "failed") return `Ad #${a.id} "${a.name}" could not be made: ${a.error ?? "unknown error"}.`;
    if (a.status === "writing") return `Ad #${a.id} "${a.name}" is still being made after 20 minutes; something may be stuck.`;
    if (a.versions === 0) return `Ad #${a.id} "${a.name}" finished without any versions, so there is nothing to show.`;
    return `Ad #${a.id} "${a.name}" is ready with ${a.versions} version${a.versions === 1 ? "" : "s"}.`;
  });
  const ready = ads.some((a) => a && a.status === null && a.versions > 0);
  return [
    "[Automatic update, not typed by the operator] The background work you started has finished.",
    ...lines,
    ready
      ? "Carry on with what the operator asked: call list_ad_campaigns for each ready version's designId and copy, then propose the next step with draft_ad_campaign or add_ad_to_campaign so the operator sees every version in the approval preview. Tell them in one line that the ads are ready. Do not ask them to check anything."
      : "Tell the operator plainly what happened and offer to try again.",
  ].join("\n");
}
