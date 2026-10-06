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
  Shuffle,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { DUR, EASE } from "@/lib/motion";
import { ideaToTopic } from "@/lib/content-studio/ideaTopic";

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
export function PostIdeas({ onPick }: { onPick: (topic: string) => void }) {
  const [ideas, setIdeas] = useState<PostIdea[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<PostIdea | null>(null);
  const [saved, setSaved] = useState<SavedIdea[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
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
    // The whole idea, not just its headline — see ideaToTopic for why handing
    // the generator the hook alone threw away the substance that made the idea
    // worth picking.
    onPick(ideaToTopic(idea));
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
    <section className="nc-section" aria-label="Post ideas">
      <div className="nc-section-head">
        <h2 className="nc-h2">{showLibrary ? "Ideas you kept" : "Ideas"}</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {saved.length > 0 && (
            <Button
              variant={showLibrary ? "secondary" : "ghost"}
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
          {(ideas || showLibrary) && (
            <Button variant="outline" size="sm" onClick={load} disabled={busy}>
              {busy ? <Loader2 size={14} className="spin" /> : <Shuffle size={14} />}
              {busy ? "Thinking" : ideas ? "Shuffle" : "Suggest ideas"}
            </Button>
          )}
        </div>
      </div>

      {error && <div style={{ fontSize: 12.5, color: "var(--danger)" }}>{error}</div>}

      {!ideas && !showLibrary ? (
        <div className="nc-ideas-empty">
          <div>
            <div className="nc-ideas-empty-title">Stuck for a topic?</div>
            <div className="nc-ideas-empty-sub">Adonis suggests six post ideas from your content pillars, each with what it teaches.</div>
          </div>
          <Button variant="outline" onClick={load} disabled={busy}>
            {busy ? <Loader2 size={15} className="spin" /> : <Lightbulb size={15} />}
            {busy ? "Thinking" : "Suggest ideas"}
          </Button>
        </div>
      ) : list.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text-tertiary)", margin: 0 }}>
          Nothing saved yet. Press the bookmark on any idea you want to keep.
        </p>
      ) : (
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={showLibrary ? "library" : "generated"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: dur, ease: EASE }}
            className="nc-ideas"
          >
            {list.map((idea, i) => {
              const isSaved = savedHooks.has(idea.hook);
              const used = (idea as SavedIdea).status === "used";
              const open = why === idea.hook;
              const chosen = picked?.hook === idea.hook;
              return (
                <motion.article
                  key={idea.hook || i}
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: dur, ease: EASE, delay: reduce ? 0 : Math.min(i, 6) * 0.03 }}
                  className={`nc-idea${chosen ? " is-chosen" : ""}${used ? " is-used" : ""}`}
                >
                  <div className="nc-idea-top">
                    <span className="nc-idea-tag">
                      {idea.pillar}
                      {used && " · used"}
                    </span>
                    <button
                      type="button"
                      className="nc-idea-save"
                      aria-label={showLibrary || isSaved ? "Remove from saved ideas" : "Save this idea"}
                      title={showLibrary ? "Remove from the library" : isSaved ? "Saved. Click to remove" : "Save for later"}
                      onClick={() => void toggleSave(idea)}
                    >
                      {showLibrary ? <Trash2 size={14} /> : isSaved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                    </button>
                  </div>
                  <button type="button" className="nc-idea-pick" onClick={() => pick(idea)}>
                    <span className="nc-idea-title">{idea.hook}</span>
                    {!open && <span className="nc-idea-line">{idea.teaches}</span>}
                  </button>
                  {open && (
                    <div className="nc-idea-why">
                      <span>{idea.teaches}</span>
                      {idea.basis && <span className="nc-idea-rests">Rests on: {idea.basis}</span>}
                      {idea.needsSource && (
                        <span className="nc-idea-source">
                          <AlertTriangle size={12} /> Find a real source before publishing: {idea.needsSource}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="nc-idea-foot">
                    <button type="button" className="nc-idea-whybtn" aria-expanded={open} onClick={() => setWhy(open ? null : idea.hook)}>
                      {open ? "Hide" : "Why this works"}
                      <ChevronDown size={13} style={{ transform: open ? "rotate(180deg)" : undefined }} />
                    </button>
                    {idea.needsSource && !open && <span className="nc-idea-chip">Needs a source</span>}
                    {chosen && <span className="nc-idea-chosen">In the box</span>}
                  </div>
                </motion.article>
              );
            })}
          </motion.div>
        </AnimatePresence>
      )}
    </section>
  );
}
