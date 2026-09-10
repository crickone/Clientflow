"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  Lightbulb,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { DUR, EASE } from "@/lib/motion";

export interface PostIdea {
  pillar: string;
  hook: string;
  teaches: string;
  basis: string;
  needsSource?: string;
}

interface SavedIdea extends PostIdea {
  id: number;
  status: "saved" | "used";
}

/**
 * "Suggest ideas" under the topic box: in-depth post ideas across the account's
 * content pillars, each showing what it teaches and the established principle
 * it rests on — so the operator can judge an idea before committing to it.
 *
 * `needsSource` is shown deliberately: the generator is forbidden from
 * inventing citations or statistics, so where a hard number would strengthen
 * the post it says what to look up instead. That turns a fabrication risk into
 * a visible task.
 *
 * TWO behaviours worth knowing about:
 *
 * 1. PICKING FOLDS THE LIST. Choosing an idea collapses the others away and
 *    leaves the chosen one as a single summary bar. The list is a decision
 *    surface, and once the decision is made it is noise sitting between the
 *    operator and the topic box they're about to write in. The bar stays
 *    clickable, so changing your mind costs one click — it's a fold, not a
 *    commitment.
 *
 * 2. IDEAS CAN BE KEPT. A generation is ephemeral: pressing "New ideas"
 *    replaces it, and the good idea you didn't want today is gone. The
 *    bookmark saves a snapshot to the library (../../lib/content-studio/
 *    ideaLibrary), which is browsable from the same control — so ideas
 *    accumulate instead of evaporating.
 *
 * Both animations respect prefers-reduced-motion: with it on, the fold is
 * instant rather than absent, because the LAYOUT change is the information —
 * only the movement is decoration.
 */
export function PostIdeas({ onPick }: { onPick: (hook: string) => void }) {
  const [ideas, setIdeas] = useState<PostIdea[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<PostIdea | null>(null);
  const [saved, setSaved] = useState<SavedIdea[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const reduce = useReducedMotion();

  const savedHooks = new Set(saved.map((s) => s.hook));
  const dur = reduce ? 0 : DUR.base;

  const loadLibrary = useCallback(async () => {
    try {
      const d = await fetch("/api/content-studio/ideas").then((r) => r.json());
      if (d.ok && Array.isArray(d.ideas)) setSaved(d.ideas as SavedIdea[]);
    } catch {
      // The library is an enhancement, not the feature — a failure here must
      // never stop someone generating or picking an idea.
    }
  }, []);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  async function load() {
    setBusy(true);
    setError(null);
    setPicked(null);
    try {
      const res = await fetch("/api/content-studio/post-ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 6 }),
      });

      // Separate a TRANSPORT failure from an API one. A deploy swapping the
      // container returns a 502 HTML page, and parsing that as JSON throws —
      // which the old catch-all reported as "Couldn't get ideas", sending
      // everyone to look at the generator when the app had simply restarted.
      // Naming what actually happened is not the same as guessing a cause.
      if (!res.ok) {
        setError(
          res.status >= 502 && res.status <= 504
            ? "The app was restarting. Give it a few seconds and try again."
            : `Couldn't get ideas — the server returned ${res.status}.`,
        );
        return;
      }

      let d: { ok?: boolean; error?: string; ideas?: unknown };
      try {
        d = await res.json();
      } catch {
        setError("The reply from Adonis wasn't readable. Try again.");
        return;
      }

      if (!d.ok) {
        setError(d.error ?? "Couldn't get ideas.");
        return;
      }
      if (!Array.isArray(d.ideas) || d.ideas.length === 0) {
        // Deliberately does NOT guess at a cause. The first version blamed the
        // AI cap and the real reason was a truncated reply, which sent me
        // looking in the wrong place — the server log carries the actual error.
        setError("No ideas came back. Try again, or write your own topic.");
        return;
      }
      setIdeas(d.ideas as PostIdea[]);
      setShowLibrary(false);
    } catch {
      // Genuinely no reply: offline, or the request was cut off.
      setError("Couldn't reach Adonis. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function pick(idea: PostIdea) {
    setPicked(idea);
    onPick(idea.hook);
    // Bookkeeping only — the operator doesn't wait on it, and a failure here
    // must not interrupt the pick.
    void fetch("/api/content-studio/ideas", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hook: idea.hook }),
    }).catch(() => {});
  }

  async function toggleSave(idea: PostIdea) {
    const already = saved.find((s) => s.hook === idea.hook);
    if (already) {
      setSaved((s) => s.filter((x) => x.hook !== idea.hook)); // optimistic
      await fetch(`/api/content-studio/ideas?id=${already.id}`, { method: "DELETE" }).catch(() => {});
      void loadLibrary();
      return;
    }
    const d = await fetch("/api/content-studio/ideas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(idea),
    })
      .then((r) => r.json())
      .catch(() => null);
    if (d?.ok && d.idea) setSaved((s) => [d.idea as SavedIdea, ...s]);
  }

  const list = showLibrary ? saved : (ideas ?? []);

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Button variant="outline" size="sm" onClick={load} disabled={busy}>
          {busy ? <Loader2 size={14} className="spin" /> : <Lightbulb size={14} />}
          {busy ? "Thinking…" : ideas ? "New ideas" : "Suggest ideas"}
        </Button>

        {saved.length > 0 && (
          <Button
            variant={showLibrary ? "primary" : "ghost"}
            size="sm"
            onClick={() => {
              setShowLibrary((v) => !v);
              setPicked(null);
            }}
          >
            <Bookmark size={14} />
            Saved ({saved.length})
          </Button>
        )}

        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
          {showLibrary ? "Ideas you kept" : "In-depth, across your content pillars"}
        </span>
      </div>

      {error && <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--danger)" }}>{error}</div>}

      <AnimatePresence initial={false} mode="wait">
        {picked ? (
          // ── folded: the chosen idea, as one bar ──
          <motion.button
            key="picked"
            type="button"
            layout
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: dur, ease: EASE }}
            onClick={() => setPicked(null)}
            style={{
              width: "100%",
              textAlign: "left",
              marginTop: 12,
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "var(--accent-soft)",
              border: "1px solid var(--accent)",
              borderRadius: "var(--radius)",
              padding: "12px 14px",
              cursor: "pointer",
              fontFamily: "inherit",
              color: "inherit",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...pillarStyle, color: "var(--accent)" }}>{picked.pillar}</div>
              <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35, marginTop: 4 }}>
                {picked.hook}
              </div>
            </div>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "var(--text-tertiary)",
                flexShrink: 0,
              }}
            >
              Change
              <ChevronDown size={14} />
            </span>
          </motion.button>
        ) : list.length > 0 ? (
          // ── open: the full list ──
          <motion.div
            key={showLibrary ? "library" : "generated"}
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: dur, ease: EASE }}
            style={{ display: "grid", gap: 8, marginTop: 12 }}
          >
            {list.map((idea, i) => {
              const isSaved = savedHooks.has(idea.hook);
              const used = (idea as SavedIdea).status === "used";
              return (
                <motion.div
                  key={idea.hook || i}
                  layout
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: dur, ease: EASE, delay: reduce ? 0 : Math.min(i, 6) * 0.03 }}
                  style={{ position: "relative" }}
                >
                  <button
                    type="button"
                    onClick={() => pick(idea)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      background: "var(--surface-1)",
                      border: "1px solid var(--hairline)",
                      borderRadius: "var(--radius)",
                      padding: "12px 44px 12px 14px",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      color: "inherit",
                      display: "grid",
                      gap: 6,
                      opacity: used ? 0.65 : 1,
                    }}
                  >
                    <span style={pillarStyle}>
                      {idea.pillar}
                      {used && " · already used"}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35 }}>{idea.hook}</span>
                    <span style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                      {idea.teaches}
                    </span>
                    {idea.basis && (
                      <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Rests on: {idea.basis}</span>
                    )}
                    {idea.needsSource && (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "flex-start",
                          gap: 6,
                          fontSize: 12,
                          color: "var(--warning)",
                          background: "var(--warning-soft)",
                          borderRadius: "var(--radius-sm)",
                          padding: "6px 9px",
                          lineHeight: 1.45,
                        }}
                      >
                        <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} />
                        Find a real source before publishing: {idea.needsSource}
                      </span>
                    )}
                  </button>

                  {/* Keep/remove sits OUTSIDE the pick button — nesting buttons
                      is invalid HTML, and one click must never mean both. */}
                  <button
                    type="button"
                    aria-label={
                      showLibrary ? "Remove from saved ideas" : isSaved ? "Remove from saved ideas" : "Save this idea"
                    }
                    title={showLibrary ? "Remove from the library" : isSaved ? "Saved — click to remove" : "Save for later"}
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleSave(idea);
                    }}
                    style={{
                      position: "absolute",
                      top: 10,
                      right: 10,
                      display: "grid",
                      placeItems: "center",
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      border: "1px solid transparent",
                      background: "transparent",
                      cursor: "pointer",
                      color: isSaved ? "var(--accent)" : "var(--text-tertiary)",
                    }}
                  >
                    {showLibrary ? (
                      <Trash2 size={14} />
                    ) : isSaved ? (
                      <BookmarkCheck size={14} />
                    ) : (
                      <Bookmark size={14} />
                    )}
                  </button>
                </motion.div>
              );
            })}

            {!showLibrary && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-tertiary)" }}>
                <RefreshCw size={11} />
                Ideas are grounded in established principles. No study, journal or statistic is cited — anything
                needing a hard number says so.
              </div>
            )}
          </motion.div>
        ) : showLibrary ? (
          <motion.p
            key="empty-library"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: dur, ease: EASE }}
            style={{ fontSize: 12.5, color: "var(--text-tertiary)", marginTop: 12 }}
          >
            Nothing saved yet. Generate some ideas and press the bookmark on any you want to keep.
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

const pillarStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono), ui-monospace, monospace",
  fontSize: 10,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--text-tertiary)",
};
