/**
 * The command palette's index, and the ranking behind its filter.
 *
 * PURE — it takes the nav tree as an argument rather than importing it, so it
 * carries no icons, no React and no `server-only`, and the whole thing is
 * testable under the plain-tsx runner.
 *
 * The index is built from the SAME nav data the sidebar renders (@/lib/ui/nav),
 * not a second hand-written list. Two lists would drift, and a palette that
 * offers a page the sidebar has hidden is worse than no palette: every gate the
 * sidebar applies — admin-only, scheduling mode, per-tenant modules, the
 * feature flags the layout enforces — has to apply here too, or the palette
 * sends people to a route that redirects them straight back.
 */

export interface NavLinkLike {
  href: string;
  label: string;
  adminOnly?: boolean;
  tenants?: string[];
  mode?: "appointments" | "timetable";
  labelKey?: string;
}
export interface NavGroupLike {
  label: string;
  adminOnly?: boolean;
  children: NavEntryLike[];
}
export type NavEntryLike = NavLinkLike | NavGroupLike;

const isGroup = (e: NavEntryLike): e is NavGroupLike => "children" in e;

export interface CommandContext {
  isAdmin: boolean;
  mode: "appointments" | "timetable";
  tenantSlug: string;
  /** Vocabulary lookup for links whose label follows the venue type ("Members" vs "Clients"). */
  vocab?: Record<string, string>;
  /** Mirrors the layout's own module gate: false hides the destination entirely. */
  pathAllowed?: (href: string) => boolean;
}

export interface Command {
  href: string;
  /** The item's own name — what the user is looking for. */
  label: string;
  /** Where it lives, e.g. "Clients" or "Marketing › Campaigns". Shown, and searched. */
  group: string;
}

/** Flatten the nav tree into a flat, gated, searchable list. */
export function buildCommands(entries: NavEntryLike[], ctx: CommandContext, trail: string[] = []): Command[] {
  const out: Command[] = [];
  for (const entry of entries) {
    if (entry.adminOnly && !ctx.isAdmin) continue;

    if (isGroup(entry)) {
      out.push(...buildCommands(entry.children, ctx, [...trail, entry.label]));
      continue;
    }
    if (entry.mode && entry.mode !== ctx.mode) continue;
    if (entry.tenants && !entry.tenants.includes(ctx.tenantSlug)) continue;
    if (ctx.pathAllowed && !ctx.pathAllowed(entry.href)) continue;

    const label = (entry.labelKey && ctx.vocab?.[entry.labelKey]) || entry.label;
    out.push({ href: entry.href, label, group: trail.join(" › ") });
  }
  return out;
}

/**
 * Score a command against a query. Higher is better; 0 means "do not show".
 *
 * Deliberately simple — prefix beats word-start beats substring — rather than a
 * fuzzy matcher. With ~40 destinations a fuzzy matcher's extra recall is noise:
 * typing "cam" should put Campaigns first, and no amount of cleverness improves
 * on that. Subsequence matching would let "cs" find "Content Studio", but it
 * also lets "cs" find half the list.
 */
export function scoreCommand(cmd: Command, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1; // no query: everything shows, in nav order
  const label = cmd.label.toLowerCase();
  const group = cmd.group.toLowerCase();

  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  // A word start inside the label: "studio" finds "Content Studio".
  if (label.split(/[\s›]+/).some((w) => w.startsWith(q))) return 60;
  if (label.includes(q)) return 40;
  // The group is worth matching — "marketing" should surface what lives there.
  if (group.startsWith(q)) return 25;
  if (group.includes(q)) return 15;
  return 0;
}

/**
 * Matching commands, best first, ties broken ALPHABETICALLY.
 *
 * Nav order was the tiebreak first, on the reasoning that the sidebar's order
 * is a considered one. It is — for the sidebar, where the groups are on screen
 * to explain it. Stripped of its groups into one flat list, that same order
 * reads as no order at all: with an empty query you are scanning forty names
 * for one you already know, and the only arrangement that helps you is the one
 * you can predict. Alphabetical also settles ties inside a score band, so
 * "Plans" and "Programs" do not swap places as the nav changes underneath.
 */
export function filterCommands(commands: Command[], query: string): Command[] {
  return commands
    .map((cmd) => ({ cmd, score: scoreCommand(cmd, query) }))
    .filter((r) => r.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.cmd.label.localeCompare(b.cmd.label) ||
        a.cmd.group.localeCompare(b.cmd.group),
    )
    .map((r) => r.cmd);
}
