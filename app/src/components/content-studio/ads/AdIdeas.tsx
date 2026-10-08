"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, Lightbulb, Loader2, Shuffle } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { DUR, EASE } from "@/lib/motion";
import type { AdGoal } from "@/lib/ads/adCopy";

/** The goal in a word or two, to fit beside the angle on the card. */
const GOAL_SHORT: Record<AdGoal, string> = {
  bookings: "Bookings",
  leads: "Leads",
  messages: "Messages",
  website: "Website visits",
  awareness: "Local reach",
};

export interface AdIdea {
  angle: string;
  hook: string;
  offer: string;
  audience: string;
  goal: AdGoal;
  why: string;
}

/**
 * "Suggest ideas" under the ad brief: the ad twin of PostIdeas, in the same
 * cards. Each concept is a different angle on a different offer or audience,
 * and picking one fills the whole brief (what it's for, who, the goal).
 *
 * Shuffle sends back every hook this screen has shown, so the next batch moves
 * on instead of rewording the last one.
 */
export function AdIdeas({ onPick }: { onPick: (idea: AdIdea) => void }) {
  const [ideas, setIdeas] = useState<AdIdea[] | null>(null);
  const [shown, setShown] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const dur = reduce ? 0 : DUR.base;

  async function load() {
    setBusy(true);
    setError(null);
    setPicked(null);
    try {
      const res = await fetch("/api/content-studio/ad-ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 6, avoid: shown }),
      });
      if (!res.ok) {
        setError(
          res.status >= 502 && res.status <= 504
            ? "The app was restarting. Give it a few seconds and try again."
            : `Couldn't get ideas. The server returned ${res.status}.`,
        );
        return;
      }
      const d = (await res.json().catch(() => null)) as { ok?: boolean; ideas?: AdIdea[]; error?: string } | null;
      if (!d?.ok) return void setError(d?.error ?? "Couldn't get ideas.");
      if (!Array.isArray(d.ideas) || d.ideas.length === 0) {
        return void setError("No ideas came back. Try again, or write your own brief.");
      }
      setIdeas(d.ideas);
      setShown((s) => [...d.ideas!.map((i) => i.hook), ...s].slice(0, 40));
    } catch {
      setError("Couldn't reach Adonis. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function pick(idea: AdIdea) {
    setPicked(idea.hook);
    onPick(idea);
  }

  return (
    <section className="nc-section" aria-label="Ad ideas">
      <div className="nc-section-head">
        <h2 className="nc-h2">Ideas</h2>
        {ideas && (
          <Button variant="outline" size="sm" onClick={load} disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : <Shuffle size={14} />}
            {busy ? "Thinking" : "Shuffle"}
          </Button>
        )}
      </div>

      {error && <div className="nc-ideas-error" role="alert">{error}</div>}

      {!ideas ? (
        <div className="nc-ideas-empty">
          <div>
            <div className="nc-ideas-empty-title">Not sure what to advertise?</div>
            <div className="nc-ideas-empty-sub">Adonis suggests six ad concepts from your services, each from a different angle.</div>
          </div>
          <Button variant="outline" onClick={load} disabled={busy}>
            {busy ? <Loader2 size={15} className="spin" /> : <Lightbulb size={15} />}
            {busy ? "Thinking" : "Suggest ideas"}
          </Button>
        </div>
      ) : (
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={ideas.map((i) => i.hook).join("|")}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: dur, ease: EASE }}
            className="nc-ideas"
          >
            {ideas.map((idea, i) => {
              const open = why === idea.hook;
              const chosen = picked === idea.hook;
              return (
                <motion.article
                  key={idea.hook || i}
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: dur, ease: EASE, delay: reduce ? 0 : Math.min(i, 6) * 0.03 }}
                  className={`nc-idea${chosen ? " is-chosen" : ""}`}
                >
                  <div className="nc-idea-top">
                    <span className="nc-idea-tag">{idea.angle}</span>
                    <span className="nc-idea-goal">{GOAL_SHORT[idea.goal]}</span>
                  </div>
                  <button type="button" className="nc-idea-pick" onClick={() => pick(idea)}>
                    <span className="nc-idea-title">{idea.hook}</span>
                    {!open && <span className="nc-idea-line">{idea.offer}</span>}
                  </button>
                  {open && (
                    <div className="nc-idea-why">
                      <span>{idea.offer}</span>
                      {idea.audience && <span className="nc-idea-rests">For: {idea.audience}</span>}
                      {idea.why && <span className="nc-idea-rests">{idea.why}</span>}
                    </div>
                  )}
                  <div className="nc-idea-foot">
                    <button type="button" className="nc-idea-whybtn" aria-expanded={open} onClick={() => setWhy(open ? null : idea.hook)}>
                      {open ? "Hide" : "Why this works"}
                      <ChevronDown size={13} style={{ transform: open ? "rotate(180deg)" : undefined }} />
                    </button>
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
