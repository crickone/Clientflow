"use client";

import { Fragment, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, ChevronDown, ChevronLeft, ChevronRight, Loader2, Minus, Pencil, Plus, Trash2 } from "lucide-react";

import { addMealAction, deleteMealAction, setMealServingsAction, updateMealAction } from "@/app/app/actions";
import { Card } from "@/components/clientapp/ui";
import { kcal, type MealItem, type MealTotals } from "@/lib/mealsModel";

export type MealView = {
  id: number;
  loggedAt: number;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  kind: "meal" | "label" | "manual";
  servings: number;
  confidence: "high" | "medium" | "low" | null;
  notes: string | null;
  hasPhoto: boolean;
  items: MealItem[];
};

type Props = {
  day: string;
  today: string;
  meals: MealView[];
  totals: MealTotals;
  target: MealTotals | null;
  week: { day: string; calories: number }[];
};

const MAX_EDGE = 1280;

/** Shrink a photo in the browser before upload: a phone photo is 3-5 MB, the AI needs far less. */
async function shrink(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("bad image"));
      i.src = url;
    });
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    return blob ?? file;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function time(ms: number) {
  return new Date(ms).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" });
}
function dayTitle(day: string, today: string) {
  if (day === today) return "Today";
  const d = new Date(`${day}T12:00:00Z`);
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (d.getTime() === yesterday.getTime()) return "Yesterday";
  return d.toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
function shiftDay(day: string, by: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}
const grams = (n: number) => `${Math.round(n)} g`;

const CONFIDENCE: Record<string, string> = { high: "Read from the label", medium: "Estimated from the photo", low: "A rough estimate: the portions are hard to see" };

/** The day's meals as M1, M2, M3: snapped and read on the spot, or typed in. */
export function MealLog({ day, today, meals, totals, target, week }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | "new" | null>(null);

  const go = (d: string) => router.push(d === today ? "/app/nutrition" : `/app/nutrition?day=${d}`);

  /** The photo is read the moment it's taken: no extra step. */
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setReading(true);
    setError(null);
    try {
      const blob = await shrink(file);
      const form = new FormData();
      form.append("file", blob, "meal.jpg");
      const res = await fetch("/api/app/meals/photo", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; meal?: { id: number } } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "Couldn't read that photo. Try again, or add the meal by hand.");
        return;
      }
      if (day !== today) router.push("/app/nutrition");
      router.refresh();
      if (data.meal) setOpen(data.meal.id); // show the breakdown straight away
    } catch {
      setError("Couldn't upload the photo. Check your connection and try again.");
    } finally {
      setReading(false);
    }
  }

  function remove(id: number) {
    start(async () => {
      const r = await deleteMealAction(id);
      if (!r.ok) setError(r.error);
      setOpen(null);
      router.refresh();
    });
  }
  function servings(m: MealView, next: number) {
    start(async () => {
      const r = await setMealServingsAction(m.id, next);
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  const pct = target && target.calories > 0 ? Math.min(100, (totals.calories / target.calories) * 100) : null;
  const over = target !== null && totals.calories > target.calories;
  const maxWeek = Math.max(1, target?.calories ?? 0, ...week.map((w) => w.calories));

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />

      <div className="ml-daynav">
        <button type="button" aria-label="Previous day" onClick={() => go(shiftDay(day, -1))}>
          <ChevronLeft size={18} />
        </button>
        <span>{dayTitle(day, today)}</span>
        <button type="button" aria-label="Next day" onClick={() => go(shiftDay(day, 1))} disabled={day >= today}>
          <ChevronRight size={18} />
        </button>
      </div>

      <Card style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span className="ml-big" data-over={over}>
            {kcal(totals.calories)}
          </span>
          {target && <span style={{ fontSize: 13, color: "var(--text-tertiary)" }}>of {kcal(target.calories)}</span>}
        </div>
        {pct !== null && (
          <div className="ml-bar" aria-hidden>
            <span style={{ width: `${pct}%` }} data-over={over} />
          </div>
        )}
        <div className="ml-macros">
          <span>
            <b>{totals.protein} g</b> protein{target ? ` / ${target.protein}` : ""}
          </span>
          <span>
            <b>{totals.carbs} g</b> carbs{target ? ` / ${target.carbs}` : ""}
          </span>
          <span>
            <b>{totals.fat} g</b> fat{target ? ` / ${target.fat}` : ""}
          </span>
        </div>
        {!target && <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Your target shows here once your coach adds a plan with calories.</div>}
      </Card>

      <div className="ml-week" aria-label="Last seven days">
        {week.map((w) => (
          <button key={w.day} type="button" onClick={() => go(w.day)} aria-current={w.day === day ? "date" : undefined} aria-label={`${w.day}: ${kcal(w.calories)}`}>
            <span className="ml-week-bar">
              <span style={{ height: `${Math.max(w.calories > 0 ? 6 : 0, (w.calories / maxWeek) * 100)}%` }} />
            </span>
            <span className="ml-week-day">{new Date(`${w.day}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "narrow", timeZone: "UTC" })}</span>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="ml-btn" onClick={() => fileRef.current?.click()} disabled={reading || pending}>
          {reading ? <Loader2 size={17} className="spin" /> : <Camera size={17} />} {reading ? "Reading your photo" : "Snap a meal or label"}
        </button>
        <button type="button" className="ml-btn ml-btn--ghost" onClick={() => setEditing(editing === "new" ? null : "new")} disabled={reading}>
          <Plus size={17} /> By hand
        </button>
      </div>

      {error && (
        <div className="ml-error" role="alert">
          {error}
        </div>
      )}

      {editing === "new" && <MealForm initial={null} onDone={() => setEditing(null)} onSaved={() => router.refresh()} />}

      {meals.length === 0 ? (
        <Card>
          <div style={{ fontSize: 13.5, color: "var(--text-secondary)", textAlign: "center", padding: "12px 0" }}>
            {day === today ? "Nothing logged yet today. Snap your next meal." : "Nothing logged this day."}
          </div>
        </Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table className="ml-table">
            <thead>
              <tr>
                <th>Meal</th>
                <th>Time</th>
                <th className="ml-num">kcal</th>
                <th className="ml-num ml-hide">P</th>
                <th className="ml-num ml-hide">C</th>
                <th className="ml-num ml-hide">F</th>
                <th aria-label="Details" />
              </tr>
            </thead>
            <tbody>
              {meals.map((m, idx) => {
                const isOpen = open === m.id;
                const label = `M${idx + 1}`;
                return (
                  <Fragment key={m.id}>
                    <tr className="ml-row" onClick={() => setOpen(isOpen ? null : m.id)} aria-expanded={isOpen}>
                      <td className="ml-name">
                        <b>{label}</b>
                        <span className="ml-sub">
                          {" "}
                          {m.name}
                          {m.kind === "label" && m.servings !== 1 ? ` · ${m.servings} servings` : ""}
                        </span>
                      </td>
                      <td className="ml-time">{time(m.loggedAt)}</td>
                      <td className="ml-num">{Math.round(m.calories)}</td>
                      <td className="ml-num ml-hide">{Math.round(m.protein)}</td>
                      <td className="ml-num ml-hide">{Math.round(m.carbs)}</td>
                      <td className="ml-num ml-hide">{Math.round(m.fat)}</td>
                      <td className="ml-chev">
                        <ChevronDown size={16} style={{ transform: isOpen ? "rotate(180deg)" : undefined }} />
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="ml-detail">
                        <td colSpan={7}>
                          {editing === m.id ? (
                            <MealForm initial={m} onDone={() => setEditing(null)} onSaved={() => router.refresh()} />
                          ) : (
                            <div style={{ display: "grid", gap: 12 }}>
                              {m.hasPhoto && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img className="ml-photo" src={`/api/app/meals/photo?meal=${m.id}`} alt="" loading="lazy" />
                              )}

                              {m.items.length > 0 && (
                                <div>
                                  <div className="ml-h">What&rsquo;s in it</div>
                                  <table className="ml-items">
                                    <tbody>
                                      {m.items.map((it, i) => (
                                        <tr key={i}>
                                          <td>
                                            <div>{it.name}</div>
                                            <div className="ml-sub">{[it.portion, it.grams ? grams(it.grams) : null].filter(Boolean).join(" · ")}</div>
                                          </td>
                                          <td className="ml-num">
                                            <div>{it.calories} kcal</div>
                                            <div className="ml-sub">
                                              {it.protein}P {it.carbs}C {it.fat}F
                                            </div>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}

                              <div className="ml-macros">
                                <span>
                                  <b>{Math.round(m.protein)} g</b> protein
                                </span>
                                <span>
                                  <b>{Math.round(m.carbs)} g</b> carbs
                                </span>
                                <span>
                                  <b>{Math.round(m.fat)} g</b> fat
                                </span>
                              </div>

                              {m.kind === "label" && (
                                <div className="ml-servings">
                                  <span>Servings eaten</span>
                                  <button type="button" aria-label="Fewer servings" onClick={() => servings(m, m.servings - (m.servings > 1 ? 1 : 0.25))} disabled={pending || m.servings <= 0.25}>
                                    <Minus size={14} />
                                  </button>
                                  <b>{m.servings}</b>
                                  <button type="button" aria-label="More servings" onClick={() => servings(m, m.servings < 1 ? m.servings + 0.25 : m.servings + 1)} disabled={pending || m.servings >= 20}>
                                    <Plus size={14} />
                                  </button>
                                </div>
                              )}

                              <div>
                                <div className="ml-h">{m.kind === "manual" ? "Added by hand" : "How it was worked out"}</div>
                                {m.kind !== "manual" && (
                                  <p className="ml-notes">
                                    {CONFIDENCE[m.confidence ?? "medium"]}
                                    {m.notes ? `. ${m.notes}` : "."}
                                  </p>
                                )}
                              </div>

                              <div style={{ display: "flex", gap: 8 }}>
                                <button type="button" className="ml-btn ml-btn--ghost ml-btn--sm" onClick={() => setEditing(m.id)}>
                                  <Pencil size={14} /> Change the numbers
                                </button>
                                <button type="button" className="ml-btn ml-btn--ghost ml-btn--sm" onClick={() => remove(m.id)} disabled={pending}>
                                  <Trash2 size={14} /> Delete
                                </button>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
        A photo of a plate is an estimate; a label is read as printed, per serving. Tap a meal to see what was counted and change it.
      </p>
    </div>
  );
}

/** Add a meal by hand, or correct one. The meal keeps its M-number; the name is what it was. */
function MealForm({ initial, onDone, onSaved }: { initial: MealView | null; onDone: () => void; onSaved: () => void }) {
  const [pending, start] = useTransition();
  const [v, setV] = useState({
    name: initial && initial.name !== "Meal" ? initial.name : "",
    calories: initial ? String(Math.round(initial.calories)) : "",
    protein: initial ? String(Math.round(initial.protein)) : "",
    carbs: initial ? String(Math.round(initial.carbs)) : "",
    fat: initial ? String(Math.round(initial.fat)) : "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  function save() {
    start(async () => {
      const r = initial ? await updateMealAction(initial.id, v) : await addMealAction(v);
      if (!r.ok) return void setError(r.error);
      onDone();
      onSaved();
    });
  }

  return (
    <form
      className="ml-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="ml-field ml-field--wide">
        <span>What was it (optional)</span>
        <input className="ml-input" value={v.name} onChange={set("name")} placeholder="e.g. Chicken wrap" maxLength={80} />
      </label>
      <label className="ml-field">
        <span>kcal</span>
        <input className="ml-input" inputMode="numeric" value={v.calories} onChange={set("calories")} placeholder="0" autoFocus={!initial} />
      </label>
      <label className="ml-field">
        <span>Protein g</span>
        <input className="ml-input" inputMode="numeric" value={v.protein} onChange={set("protein")} placeholder="0" />
      </label>
      <label className="ml-field">
        <span>Carbs g</span>
        <input className="ml-input" inputMode="numeric" value={v.carbs} onChange={set("carbs")} placeholder="0" />
      </label>
      <label className="ml-field">
        <span>Fat g</span>
        <input className="ml-input" inputMode="numeric" value={v.fat} onChange={set("fat")} placeholder="0" />
      </label>
      {error && (
        <div className="ml-error ml-field--wide" role="alert">
          {error}
        </div>
      )}
      <div className="ml-field--wide" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="ml-btn ml-btn--ghost ml-btn--sm" onClick={onDone} disabled={pending}>
          Cancel
        </button>
        <button type="submit" className="ml-btn ml-btn--sm" disabled={pending || !v.calories.trim()}>
          {pending ? <Loader2 size={14} className="spin" /> : null} {initial ? "Save" : "Add meal"}
        </button>
      </div>
    </form>
  );
}
