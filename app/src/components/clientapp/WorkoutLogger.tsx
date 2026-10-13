"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Minus, Plus, Timer, Trash2, Trophy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card, PageTitle, SectionTitle } from "@/components/clientapp/ui";
import {
  addWorkoutExerciseAction,
  discardWorkoutAction,
  finishWorkoutAction,
  removeWorkoutExerciseAction,
  saveWorkoutAction,
  type ExerciseHit,
  type FinishResult,
} from "@/app/app/actions";
import { ExercisePicker } from "@/components/clientapp/ExercisePicker";
import { SECTIONS } from "@/lib/workoutModel";
import {
  completeSet,
  durationLabel,
  formatSet,
  parseReps,
  parseWeight,
  restLabel,
  targetRepsNumber,
  volumeKg,
  type LoggedSet,
  type SessionExercise,
  type SessionView,
} from "@/lib/workoutLogModel";

/** What the member is typing: raw strings, so "62." survives until it parses. */
interface DraftSet {
  w: string;
  r: string;
  done: boolean;
}
type Draft = Record<number, DraftSet[]>;

function toDraft(s: LoggedSet): DraftSet {
  return { w: s.weightKg === null ? "" : String(s.weightKg), r: s.reps === null ? "" : String(s.reps), done: s.done };
}
function toLogged(d: DraftSet): LoggedSet {
  return { weightKg: parseWeight(d.w), reps: parseReps(d.r), done: d.done };
}

function clock(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The member's workout log for one programme day: a row per set with what
 * they did last time, kg and reps boxes, and a tick. Ticking a blank set fills
 * it from last time (or the coach's target reps) and starts the rest timer.
 * Every change saves to the server shortly after; a finished workout can be
 * reopened from history and corrected.
 */
export function WorkoutLogger({ session, previous }: { session: SessionView; previous: Record<string, LoggedSet[]> }) {
  const router = useRouter();
  const finishedAlready = session.finishedAt !== null;
  const [draft, setDraft] = useState<Draft>(() => Object.fromEntries(session.exercises.map((e) => [e.id, e.sets.map(toDraft)])));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [now, setNow] = useState(() => Date.now());
  const [rest, setRest] = useState<{ until: number; total: number } | null>(null);
  const [confirm, setConfirm] = useState<"finish" | "discard" | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Extract<FinishResult, { ok: true }> | null>(null);
  const [exercises, setExercises] = useState<SessionExercise[]>(session.exercises);
  const [prevMap, setPrevMap] = useState(previous);
  const [picking, setPicking] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);

  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(draft);
  latest.current = draft;

  const payload = useCallback(
    () => Object.entries(latest.current).map(([id, sets]) => ({ id: Number(id), sets: sets.map(toLogged) })),
    [],
  );

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current) return;
    dirty.current = false;
    setSaveState("saving");
    const r = await saveWorkoutAction(session.id, payload()).catch(() => ({ ok: false }));
    if (!r.ok) dirty.current = true;
    setSaveState(r.ok ? "saved" : "error");
  }, [payload, session.id]);

  function update(exId: number, fn: (sets: DraftSet[]) => DraftSet[]) {
    setDraft((d) => ({ ...d, [exId]: fn(d[exId] ?? []) }));
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 800);
  }

  // Save on the way out: tab hidden, app switched, page left.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void flush();
    };
  }, [flush]);

  // The clock only runs during a rest countdown.
  useEffect(() => {
    if (!rest) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [rest]);

  useEffect(() => {
    if (rest && now >= rest.until) {
      setRest(null);
      try {
        navigator.vibrate?.([180, 80, 180]);
      } catch {
        /* not supported */
      }
    }
  }, [now, rest]);

  function tick(exId: number, i: number, restSeconds: number, targetReps: string | null, prev: LoggedSet | undefined) {
    const sets = draft[exId];
    const s = sets[i];
    if (s.done) {
      update(exId, (xs) => xs.map((x, k) => (k === i ? { ...x, done: false } : x)));
      return;
    }
    const filled = completeSet(toLogged(s), prev, i > 0 ? toLogged(sets[i - 1]) : undefined, targetReps);
    update(exId, (xs) => xs.map((x, k) => (k === i ? toDraft(filled) : x)));
    if (!finishedAlready && restSeconds > 0) setRest({ until: Date.now() + restSeconds * 1000, total: restSeconds });
  }

  /** Warm-up and cool-down are a tick per exercise: one tap marks every set. */
  function tickAll(exId: number) {
    const allDone = (draft[exId] ?? []).every((x) => x.done);
    update(exId, (xs) => xs.map((x) => ({ ...x, done: !allDone })));
  }

  async function addExercise(hit: ExerciseHit) {
    setPicking(false);
    const r = await addWorkoutExerciseAction(session.id, hit);
    if (!r.ok) return void toast.error(r.error);
    setExercises((xs) => [...xs, r.exercise]);
    setDraft((d) => ({ ...d, [r.exercise.id]: r.exercise.sets.map(toDraft) }));
    if (r.previous.length) setPrevMap((m) => ({ ...m, [r.exercise.exerciseKey]: r.previous }));
    setTimeout(() => document.getElementById(`wl-ex-${r.exercise.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  }

  async function removeExercise(id: number) {
    setRemoving(null);
    const r = await removeWorkoutExerciseAction(session.id, id);
    if (!r.ok) return void toast.error("Couldn't remove that exercise.");
    setExercises((xs) => xs.filter((x) => x.id !== id));
    setDraft((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
  }

  const all = exercises.flatMap((e) => draft[e.id] ?? []);
  const doneCount = all.filter((s) => s.done).length;
  const left = all.length - doneCount;

  async function finish() {
    setBusy(true);
    if (timer.current) clearTimeout(timer.current);
    dirty.current = false;
    const r = await finishWorkoutAction(session.id, payload());
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    if (finishedAlready) {
      toast.success("Changes saved");
      router.push("/app/workouts/history");
      return;
    }
    setRest(null);
    setResult(r);
    window.scrollTo({ top: 0 });
  }

  async function discard() {
    setBusy(true);
    if (timer.current) clearTimeout(timer.current);
    dirty.current = false;
    const r = await discardWorkoutAction(session.id);
    setBusy(false);
    if (!r.ok) return void toast.error("Couldn't delete this workout.");
    toast.success(finishedAlready ? "Workout deleted" : "Workout discarded");
    router.push(finishedAlready ? "/app/workouts/history" : "/app/workouts");
  }

  if (result) {
    const logged = exercises.map((e) => ({ sets: (draft[e.id] ?? []).map(toLogged) }));
    const vol = volumeKg(logged);
    return (
      <div className="wl">
        <PageTitle sub={`${session.programTitle} · ${session.dayName}`}>Workout done</PageTitle>
        <Card style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, padding: 16 }}>
          <Stat label="Time" value={durationLabel(Date.now() - session.startedAt)} />
          <Stat label="Sets" value={String(doneCount)} />
          <Stat label="Lifted" value={vol > 0 ? `${vol.toLocaleString("en-IE")} kg` : "-"} />
        </Card>
        {result.bests.length > 0 && (
          <Card style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14.5, fontWeight: 600, color: "var(--text-primary)" }}>
              <Trophy size={17} style={{ color: "var(--accent-ink)" }} />
              New best{result.bests.length > 1 ? "s" : ""}
            </div>
            {result.bests.map((b) => (
              <div key={b.name} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, color: "var(--text-secondary)" }}>
                <span>{b.name}</span>
                <span style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{formatSet(b)}</span>
              </div>
            ))}
          </Card>
        )}
        <div style={{ display: "grid", gap: 8 }}>
          <Button onClick={() => router.push("/app/workouts/history")} style={{ width: "100%" }}>
            See my workout history
          </Button>
          <Button variant="secondary" onClick={() => router.push("/app/workouts")} style={{ width: "100%" }}>
            Back to workouts
          </Button>
        </div>
      </div>
    );
  }

  const started = new Date(session.startedAt);
  const sub = finishedAlready
    ? `Logged ${started.toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" })} · ${session.programTitle}`
    : session.programTitle;

  return (
    <div className="wl">
      <PageTitle sub={sub}>{session.dayName}</PageTitle>

      {SECTIONS.map((sec) => {
        const inSection = exercises.filter((e) => e.section === sec.key);
        if (inSection.length === 0) return null;
        return (
          <div key={sec.key} className="wl-section">
            {SECTIONS.filter((s) => exercises.some((e) => e.section === s.key)).length > 1 && <SectionTitle>{sec.label}</SectionTitle>}
            {inSection.map((ex) => {
              const sets = draft[ex.id] ?? [];
              const prev = prevMap[ex.exerciseKey] ?? [];
              const allDone = sets.length > 0 && sets.every((s) => s.done);
              if (sec.key !== "workout") {
                return (
                  <Card key={ex.id} style={{ padding: "12px 12px 12px 16px" }}>
                    <div className="wl-check" data-done={allDone}>
                      <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 2 }}>
                        <span className="wl-ex-name">{ex.name}</span>
                        <span className="wl-ex-target">
                          {ex.targetSets > 1 ? `${ex.targetSets} sets` : ""}
                          {ex.targetSets > 1 && ex.targetReps ? " x " : ""}
                          {ex.targetReps ?? ""}
                        </span>
                        {ex.notes && <span className="wl-ex-notes">{ex.notes}</span>}
                      </div>
                      <button type="button" className="wl-tick" aria-pressed={allDone} aria-label={allDone ? `Untick ${ex.name}` : `Tick off ${ex.name}`} onClick={() => tickAll(ex.id)}>
                        <Check size={18} strokeWidth={2.6} />
                      </button>
                    </div>
                  </Card>
                );
              }
              return (
                <Card key={ex.id} style={{ padding: "14px 12px 10px", scrollMarginTop: 80 }}>
                  <span id={`wl-ex-${ex.id}`} />
                  <div className="wl-ex-head">
                    <div className="wl-ex-name" data-done={allDone}>
                      {ex.name}
                      {allDone && <Check size={16} aria-label="All sets done" />}
                    </div>
                    <div className="wl-ex-target">
                      {ex.targetSets} {ex.targetSets === 1 ? "set" : "sets"}
                      {ex.targetReps ? ` x ${ex.targetReps}` : ""}
                      {ex.restSeconds > 0 ? ` · rest ${restLabel(ex.restSeconds)}` : ""}
                    </div>
                    {ex.notes && <div className="wl-ex-notes">{ex.notes}</div>}
                  </div>

                  <div className="wl-grid wl-grid-head" aria-hidden>
                    <span>Set</span>
                    <span>Last time</span>
                    <span>kg</span>
                    <span>Reps</span>
                    <span />
                  </div>
                  {sets.map((s, i) => {
                    const p = prev[i];
                    return (
                      <div key={i} className="wl-grid wl-set" data-done={s.done}>
                        <span className="wl-setno">{i + 1}</span>
                        <span className="wl-prev">{p && (p.weightKg !== null || p.reps !== null) ? formatSet(p) : "-"}</span>
                        <input
                          className="wl-input"
                          inputMode="decimal"
                          enterKeyHint="next"
                          aria-label={`${ex.name} set ${i + 1} weight in kg`}
                          placeholder={p?.weightKg != null ? String(p.weightKg) : ""}
                          value={s.w}
                          onChange={(e) => update(ex.id, (xs) => xs.map((x, k) => (k === i ? { ...x, w: e.target.value.replace(/[^\d.,]/g, "").slice(0, 6) } : x)))}
                        />
                        <input
                          className="wl-input"
                          inputMode="numeric"
                          enterKeyHint="done"
                          aria-label={`${ex.name} set ${i + 1} reps`}
                          placeholder={p?.reps != null ? String(p.reps) : targetRepsNumber(ex.targetReps)?.toString() ?? ""}
                          value={s.r}
                          onChange={(e) => update(ex.id, (xs) => xs.map((x, k) => (k === i ? { ...x, r: e.target.value.replace(/\D/g, "").slice(0, 3) } : x)))}
                        />
                        <button
                          type="button"
                          className="wl-tick"
                          aria-pressed={s.done}
                          aria-label={s.done ? `Untick set ${i + 1}` : `Tick off set ${i + 1}`}
                          onClick={() => tick(ex.id, i, ex.restSeconds, ex.targetReps, p)}
                        >
                          <Check size={18} strokeWidth={2.6} />
                        </button>
                      </div>
                    );
                  })}
                  <div className="wl-set-actions">
                    <button type="button" className="wl-link" onClick={() => update(ex.id, (xs) => (xs.length >= 20 ? xs : [...xs, { w: xs[xs.length - 1]?.w ?? "", r: "", done: false }]))}>
                      <Plus size={14} /> Add set
                    </button>
                    {sets.length > 1 && !sets[sets.length - 1].done && (
                      <button type="button" className="wl-link" onClick={() => update(ex.id, (xs) => xs.slice(0, -1))}>
                        <Minus size={14} /> Remove last set
                      </button>
                    )}
                    {removing === ex.id ? (
                      <button type="button" className="wl-link wl-link-danger" style={{ marginLeft: "auto" }} onClick={() => removeExercise(ex.id)}>
                        Tap again to remove
                      </button>
                    ) : (
                      <button type="button" className="wl-link wl-link-quiet" style={{ marginLeft: "auto" }} aria-label={`Remove ${ex.name}`} onClick={() => setRemoving(ex.id)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        );
      })}

      {exercises.length === 0 && (
        <Card style={{ display: "grid", gap: 6, textAlign: "center", padding: "22px 16px" }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>Add your first exercise</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Search the gym&rsquo;s library or type your own.</div>
        </Card>
      )}
      <Button variant="secondary" onClick={() => setPicking(true)} style={{ width: "100%" }}>
        <Plus size={16} /> Add exercise
      </Button>
      {picking && <ExercisePicker onClose={() => setPicking(false)} onPick={addExercise} />}

      <div className="wl-footer">
        {confirm === "finish" ? (
          <Card style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 14, color: "var(--text-primary)" }}>
              {left} {left === 1 ? "set isn't" : "sets aren't"} ticked. Unticked sets are saved but don&rsquo;t count.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
              <Button variant="secondary" onClick={() => setConfirm(null)}>
                Keep going
              </Button>
              <Button onClick={finish} loading={busy}>
                Finish
              </Button>
            </div>
          </Card>
        ) : confirm === "discard" ? (
          <Card style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 14, color: "var(--text-primary)" }}>
              {finishedAlready ? "Delete this workout from your history?" : "Discard this workout? Nothing from it will be kept."}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
              <Button variant="secondary" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={discard} loading={busy}>
                {finishedAlready ? "Delete" : "Discard"}
              </Button>
            </div>
          </Card>
        ) : (
          <>
            <Button onClick={() => (!finishedAlready && left > 0 && doneCount > 0 ? setConfirm("finish") : finish())} loading={busy} disabled={!finishedAlready && doneCount === 0} style={{ width: "100%" }}>
              {finishedAlready ? "Save changes" : doneCount === 0 ? "Tick off a set to finish" : "Finish workout"}
            </Button>
            <button type="button" className="wl-link wl-discard" onClick={() => setConfirm("discard")}>
              {finishedAlready ? "Delete this workout" : "Discard workout"}
            </button>
          </>
        )}
      </div>

      {!finishedAlready && (
        <div className="wl-bar" role="status" aria-live="polite">
          {rest ? (
            <>
              <span className="wl-bar-fill" style={{ transform: `scaleX(${Math.max(0, (rest.until - now) / (rest.total * 1000))})` }} />
              <Timer size={16} />
              <span className="wl-bar-main">Rest {clock(rest.until - now)}</span>
              <button type="button" className="wl-bar-btn" onClick={() => setRest((r) => (r ? { until: r.until - 15000, total: r.total } : r))}>
                -15
              </button>
              <button type="button" className="wl-bar-btn" onClick={() => setRest((r) => (r ? { until: r.until + 15000, total: r.total + 15 } : r))}>
                +15
              </button>
              <button type="button" className="wl-bar-btn" onClick={() => setRest(null)}>
                Skip
              </button>
            </>
          ) : (
            <>
              <span className="wl-bar-main">
                {doneCount} of {all.length} sets
              </span>
              <span className="wl-bar-save">{saveState === "saving" ? "Saving" : saveState === "error" ? "Not saved yet" : saveState === "saved" ? "Saved" : ""}</span>
            </>
          )}
        </div>
      )}
      {finishedAlready && saveState === "error" && <div style={{ fontSize: 12.5, color: "var(--danger)" }}>Not saved. Check your connection.</div>}
      {finishedAlready && (
        <Link href="/app/workouts/history" className="wl-link" style={{ justifySelf: "center" }}>
          Back to history
        </Link>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "grid", gap: 2, textAlign: "center" }}>
      <span style={{ fontSize: 18, fontWeight: 600, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
      <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{label}</span>
    </div>
  );
}

