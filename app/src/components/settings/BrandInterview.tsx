"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, ChevronLeft, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import type { Answers, Question } from "@/lib/brandInterview/questions";
import type { BrandDraft } from "@/lib/ai/writeBrandProfile";
import { applyBrandDraftAction, saveInterviewAction, writeBrandDraftAction } from "@/app/settings/business/interview/actions";

type Stage = "intro" | "ask" | "writing" | "review";
type FieldKey = keyof BrandDraft;

const FIELDS: { key: FieldKey; title: string; help: string; rows: number }[] = [
  { key: "brief", title: "Brief", help: "What the business is. Every piece of content starts from this.", rows: 7 },
  { key: "marketingBrain", title: "Marketing brain", help: "Who you serve, what to teach, how to sound, what never to say.", rows: 16 },
  { key: "voiceNotes", title: "Tone notes", help: "How your content should sound.", rows: 5 },
  { key: "imageStyle", title: "AI image style", help: "The look of every AI-made photo.", rows: 3 },
  { key: "tagline", title: "Tagline", help: "The short line that describes you.", rows: 1 },
];

const WRITING_STEPS = ["Reading your answers", "Writing your brief", "Building your marketing brain", "Finding your tone", "Choosing your photo style"];

/**
 * The brand interview. One question at a time, saved as it goes; then
 * Adonis writes the brand texts and the owner reviews, edits and keeps them.
 */
export function BrandInterview({
  businessName,
  questions,
  initialAnswers,
  pendingDraft = null,
  current,
}: {
  businessName: string;
  questions: Question[];
  initialAnswers: Answers;
  /** A written brand that hasn't been saved to the profile yet: reopen on it. */
  pendingDraft?: BrandDraft | null;
  current: BrandDraft;
}) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [stage, setStage] = useState<Stage>(pendingDraft ? "review" : "intro");
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const [answers, setAnswers] = useState<Answers>(initialAnswers);
  const [draft, setDraft] = useState<BrandDraft | null>(pendingDraft);
  const [keep, setKeep] = useState<Record<FieldKey, boolean>>({ tagline: true, brief: true, voiceNotes: true, marketingBrain: true, imageStyle: true });
  const [writingStep, setWritingStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  const q = questions[i];
  const started = Object.keys(initialAnswers).length > 1;
  const a = answers[q?.id] ?? {};

  // Save quietly as the owner goes; a lost tab costs nothing.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (stage !== "ask") return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveInterviewAction(answers).catch(() => {}), 700);
  }, [answers, stage]);

  useEffect(() => {
    if (stage === "ask") inputRef.current?.focus();
  }, [i, stage]);

  useEffect(() => {
    if (stage !== "writing") return;
    const t = setInterval(() => setWritingStep((s) => Math.min(s + 1, WRITING_STEPS.length - 1)), 6000);
    return () => clearInterval(t);
  }, [stage]);

  const set = (patch: { text?: string; picks?: string[] }) =>
    setAnswers((prev) => ({ ...prev, [q.id]: { ...prev[q.id], ...patch } }));

  function togglePick(opt: string) {
    const picks = a.picks ?? [];
    if (q.kind === "single") return set({ picks: picks[0] === opt ? [] : [opt] });
    if (picks.includes(opt)) return set({ picks: picks.filter((p) => p !== opt) });
    set({ picks: [...picks, opt] });
  }

  function go(delta: number) {
    setDir(delta);
    if (i + delta >= questions.length) return void write();
    if (i + delta < 0) return setStage("intro");
    setI(i + delta);
  }

  async function write() {
    setError(null);
    setWritingStep(0);
    setStage("writing");
    const res = await writeBrandDraftAction(answers).catch(() => ({
      ok: false as const,
      error: "Lost contact with the server while Adonis was writing. If it finished, reopen this page and it will be waiting; otherwise press Write my brand again.",
    }));
    if (!res.ok) {
      setError(res.error);
      setStage("ask");
      return;
    }
    setDraft(res.draft);
    setStage("review");
  }

  async function apply() {
    if (!draft) return;
    setSaving(true);
    const input = Object.fromEntries(FIELDS.filter((f) => keep[f.key]).map((f) => [f.key, draft[f.key]]));
    const res = await applyBrandDraftAction(input).catch(() => ({
      ok: false as const,
      error: "Couldn't reach the server, so nothing was saved yet. Your brand is still here: press Save again.",
    }));
    setSaving(false);
    if (!res.ok) return void toast.error(res.error, { duration: 10000 });
    toast.success("Saved. Adonis will write from this from now on.");
    // A full load, never the browser's cached copy of Business profile: the
    // cached page held the old empty fields (see updateBusinessProfile).
    setTimeout(() => window.location.assign("/settings/business"), 600);
  }

  const answered = useMemo(
    () => questions.filter((x) => (answers[x.id]?.text ?? "").trim() || (answers[x.id]?.picks ?? []).length).length,
    [answers, questions],
  );
  const hasAnswer = !!((a.text ?? "").trim() || (a.picks ?? []).length);
  const slide = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, y: dir > 0 ? 24 : -24 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: dir > 0 ? -24 : 24 },
      };

  return (
    <div className="bi">
      <div className="bi-top">
        <Link href="/settings/business" className="bi-back">
          <ChevronLeft size={15} /> Business profile
        </Link>
        {stage === "ask" && (
          <div className="bi-progress" aria-label={`Question ${i + 1} of ${questions.length}`}>
            {questions.map((x, n) => (
              <span key={x.id} className={n < i ? "is-done" : n === i ? "is-now" : undefined} />
            ))}
          </div>
        )}
      </div>

      <div className="bi-stage">
        <AnimatePresence mode="wait" initial={false}>
          {stage === "intro" && (
            <motion.section key="intro" className="bi-card bi-intro" {...slide} transition={{ duration: 0.35 }}>
              <span className="bi-mark" aria-hidden>
                <Sparkles size={22} />
              </span>
              <p className="bi-eyebrow">Brand interview</p>
              <h1 className="bi-h1">Tell Adonis about {businessName || "your business"}.</h1>
              <p className="bi-lead">
                {questions.length} short questions about who you are, who you serve and how you sound. Adonis then writes your brief,
                marketing brain, tone and photo style, and you choose what to keep.
              </p>
              <ul className="bi-facts">
                <li>About 5 minutes</li>
                <li>Skip anything you like</li>
                <li>Saved as you go</li>
              </ul>
              <button type="button" className="btn btn--primary btn--lg bi-go" onClick={() => setStage("ask")}>
                {started ? "Carry on" : "Start"} <ArrowRight size={16} />
              </button>
            </motion.section>
          )}

          {stage === "ask" && q && (
            <motion.section key={q.id} className="bi-card" {...slide} transition={{ duration: 0.3 }}>
              <p className="bi-eyebrow">
                {q.section} <span className="bi-count">{i + 1} / {questions.length}</span>
              </p>
              <h2 className="bi-q">{q.title}</h2>
              {q.help && <p className="bi-help">{q.help}</p>}

              {(q.kind === "chips" || q.kind === "single") && (
                <div className="bi-chips" role="group" aria-label={q.title}>
                  {q.options!.map((opt) => {
                    const on = (a.picks ?? []).includes(opt);
                    return (
                      <button key={opt} type="button" className={`bi-chip${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => togglePick(opt)}>
                        {on && <Check size={14} strokeWidth={3} />}
                        {opt}
                      </button>
                    );
                  })}
                </div>
              )}

              {q.kind === "text" ? (
                <input
                  key={`t-${q.id}`}
                  ref={inputRef}
                  className="bi-input"
                  value={a.text ?? ""}
                  placeholder={q.placeholder}
                  onChange={(e) => set({ text: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && go(1)}
                />
              ) : q.kind === "long" ? (
                <textarea
                  key={`l-${q.id}`}
                  ref={inputRef}
                  className="bi-input bi-long"
                  value={a.text ?? ""}
                  placeholder={q.placeholder}
                  rows={4}
                  onChange={(e) => set({ text: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && go(1)}
                />
              ) : q.kind === "chips" ? (
                <input
                  key={`o-${q.id}`}
                  className="bi-input bi-other"
                  value={a.text ?? ""}
                  placeholder="Anything else? Type it here"
                  onChange={(e) => set({ text: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && go(1)}
                />
              ) : null}

              {error && <p className="bi-error" role="alert">{error}</p>}

              <div className="bi-nav">
                <button type="button" className="bi-ghost" onClick={() => go(-1)}>
                  <ArrowLeft size={15} /> Back
                </button>
                <span className="bi-gap" />
                {!hasAnswer && i < questions.length - 1 && (
                  <button type="button" className="bi-ghost" onClick={() => go(1)}>
                    Skip
                  </button>
                )}
                <button type="button" className="btn btn--primary btn--md bi-next" onClick={() => go(1)}>
                  {i === questions.length - 1 ? (
                    <>
                      <Sparkles size={15} /> Write my brand
                    </>
                  ) : (
                    <>
                      Next <ArrowRight size={15} />
                    </>
                  )}
                </button>
              </div>
              {q.kind === "long" && <p className="bi-hint">Ctrl or Cmd + Enter to continue</p>}
            </motion.section>
          )}

          {stage === "writing" && (
            <motion.section key="writing" className="bi-card bi-writing" {...slide} transition={{ duration: 0.35 }} aria-live="polite">
              <span className="bi-mark is-busy" aria-hidden>
                <Loader2 size={22} className="spin" />
              </span>
              <h2 className="bi-q">Adonis is writing your brand.</h2>
              <p className="bi-help">From {answered} answers. This takes about a minute.</p>
              <ol className="bi-steps">
                {WRITING_STEPS.map((s, n) => (
                  <li key={s} className={n < writingStep ? "is-done" : n === writingStep ? "is-now" : undefined}>
                    <span className="bi-step-mark">{n < writingStep && <Check size={12} strokeWidth={3} />}</span>
                    {s}
                  </li>
                ))}
              </ol>
            </motion.section>
          )}

          {stage === "review" && draft && (
            <motion.section key="review" className="bi-review" {...slide} transition={{ duration: 0.35 }}>
              <p className="bi-eyebrow">Review</p>
              <h2 className="bi-h1">Here&rsquo;s your brand.</h2>
              <p className="bi-lead">Edit anything, untick what you don&rsquo;t want, then save. You can change all of it later in Business profile.</p>
              <div className="bi-fields">
                {FIELDS.map((f) => {
                  const replacing = !!current[f.key]?.trim();
                  return (
                    <div key={f.key} className={`bi-field${keep[f.key] ? "" : " is-off"}`}>
                      <div className="bi-field-head">
                        <div>
                          <div className="bi-field-title">{f.title}</div>
                          <div className="bi-field-help">
                            {f.help}
                            {replacing && keep[f.key] ? " Replaces what you have now." : ""}
                          </div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={keep[f.key]}
                          className={`bi-keep${keep[f.key] ? " is-on" : ""}`}
                          onClick={() => setKeep((k) => ({ ...k, [f.key]: !k[f.key] }))}
                        >
                          {keep[f.key] && <Check size={13} strokeWidth={3} />}
                          {keep[f.key] ? "Keep" : "Skip"}
                        </button>
                      </div>
                      <textarea
                        className="bi-field-text"
                        rows={f.rows}
                        value={draft[f.key]}
                        disabled={!keep[f.key]}
                        onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="bi-savebar">
                <button type="button" className="bi-ghost" onClick={() => { setStage("ask"); setI(0); }}>
                  <ArrowLeft size={15} /> Change my answers
                </button>
                <span className="bi-gap" />
                <button type="button" className="bi-ghost" onClick={() => void write()}>
                  <Sparkles size={15} /> Write it again
                </button>
                <button type="button" className="btn btn--primary btn--md" onClick={() => void apply()} disabled={saving || !FIELDS.some((f) => keep[f.key])}>
                  {saving ? <Loader2 size={15} className="spin" /> : <Check size={15} />} Save to my profile
                </button>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
