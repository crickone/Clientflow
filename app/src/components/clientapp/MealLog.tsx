"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, ChevronDown, Loader2, Minus, Pencil, Plus, Trash2, X } from "lucide-react";

import {
  addMealAction,
  addMealItemAction,
  deleteMealAction,
  removeMealItemAction,
  setMealItemGramsAction,
  setMealServingsAction,
  updateMealAction,
} from "@/app/app/actions";
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
  /** Where the target comes from, and (when the business has InBody) where to pick a goal. */
  source: { kind: "goal"; label: string } | { kind: "plan" } | null;
  goalHref: string | null;
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

const time = (ms: number) => new Date(ms).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" });
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "narrow", timeZone: "UTC" });
function dayTitle(day: string, today: string) {
  if (day === today) return "Today";
  const d = new Date(`${day}T12:00:00Z`);
  const y = new Date(`${today}T12:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  return d.getTime() === y.getTime() ? "Yesterday" : longDay(day);
}

const CONFIDENCE: Record<string, string> = {
  high: "Read from the label.",
  medium: "Estimated from the photo.",
  low: "A rough estimate: the portions are hard to see.",
};

/** The day's meals as M1, M2, M3: snapped and read on the spot, or typed in, with every number open to correction. */
export function MealLog({ day, today, meals, totals, target, source, goalHref, week }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<string | null>(null); // the photo being read
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [justRead, setJustRead] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const go = (d: string) => router.push(d === today ? "/app/nutrition" : `/app/nutrition?day=${d}`);
  const refresh = () => router.refresh();

  /** The photo is read the moment it's taken: it shows in the list at once, and becomes the meal when the numbers come back. */
  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setPreview(URL.createObjectURL(file));
    try {
      const blob = await shrink(file);
      const form = new FormData();
      form.append("file", blob, "meal.jpg");
      const res = await fetch("/api/app/meals/photo", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; meal?: { id: number; kind: string } } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "Couldn't read that photo. Try again, or add the meal by hand.");
        return;
      }
      if (day !== today) router.push("/app/nutrition");
      refresh();
      if (data.meal) {
        setOpen(data.meal.id);
        setJustRead(data.meal.kind === "meal" ? data.meal.id : null);
      }
    } catch {
      setError("Couldn't upload the photo. Check your connection and try again.");
    } finally {
      setPreview(null);
    }
  }

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong.");
      refresh();
    });

  const left = target ? target.calories - totals.calories : null;
  const pct = target && target.calories > 0 ? Math.min(100, (totals.calories / target.calories) * 100) : 0;
  const maxWeek = Math.max(1, target?.calories ?? 0, ...week.map((w) => w.calories));

  return (
    <div className="ml">
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />

      <div className="ml-head">
        <div className="ml-title">
          {dayTitle(day, today)}
          {day === today && <span>{longDay(day)}</span>}
        </div>
        <div className="ml-week" aria-label="Last seven days">
          {week.map((w) => (
            <button key={w.day} type="button" onClick={() => go(w.day)} aria-current={w.day === day ? "date" : undefined} aria-label={`${longDay(w.day)}: ${kcal(w.calories)}`}>
              <span className="ml-week-day">{weekday(w.day)}</span>
              <span className="ml-week-bar">
                <span style={{ height: `${Math.max(w.calories > 0 ? 8 : 0, (w.calories / maxWeek) * 100)}%` }} />
              </span>
              <span className="ml-week-kcal">{w.calories > 0 ? Math.round(w.calories) : ""}</span>
            </button>
          ))}
        </div>
      </div>

      <section className="ml-summary">
        <div className="ml-big" data-over={left !== null && left < 0}>
          {kcal(totals.calories)}
        </div>
        <div className="ml-left">
          {left === null ? "logged this day" : left >= 0 ? `${Math.round(left).toLocaleString("en-IE")} kcal left of ${target!.calories.toLocaleString("en-IE")}` : `${Math.round(-left).toLocaleString("en-IE")} kcal over ${target!.calories.toLocaleString("en-IE")}`}
        </div>
        {target && (
          <div className="ml-bar" aria-hidden>
            <span style={{ width: `${pct}%` }} data-over={left !== null && left < 0} />
          </div>
        )}
      </section>

      <div className="ml-stats" aria-label="Today's macros">
        {(
          [
            ["Protein", totals.protein, target?.protein],
            ["Carbs", totals.carbs, target?.carbs],
            ["Fat", totals.fat, target?.fat],
          ] as const
        ).map(([name, have, want]) => (
          <div key={name} className="ml-stat" data-over={want ? have > want : false}>
            <span className="ml-stat-name">{name}</span>
            <span className="ml-stat-num">
              {Math.round(have)}
              <small>g</small>
            </span>
            {want ? (
              <>
                <span className="ml-stat-of">of {Math.round(want)} g</span>
                <span className="ml-macro-bar" aria-hidden>
                  <span style={{ width: `${Math.min(100, (have / want) * 100)}%` }} data-over={have > want} />
                </span>
              </>
            ) : null}
          </div>
        ))}
      </div>


      {!target && (
        <div className="ml-hint">
          {goalHref ? (
            <>
              <Link href={goalHref} className="ml-hint-link">Pick a goal</Link> to set your targets, or your coach adds a plan with calories.
            </>
          ) : (
            "Your targets show here once your coach adds a plan with calories."
          )}
        </div>
      )}
      {target && source?.kind === "goal" && (
        <div className="ml-hint">
          Target from your goal, {source.label.toLowerCase()}.{goalHref && (<> <Link href={goalHref} className="ml-hint-link">Change</Link></>)}
        </div>
      )}
      {target && source?.kind === "plan" && goalHref && (
        <div className="ml-hint">
          Target from your coach&rsquo;s plan. <Link href={goalHref} className="ml-hint-link">Pick a goal</Link> to use that instead.
        </div>
      )}

      <button type="button" className="ml-camera" onClick={() => fileRef.current?.click()} disabled={preview !== null || pending}>
        {preview ? <Loader2 size={18} className="spin" /> : <Camera size={18} />} {preview ? "Reading your photo" : "Snap a meal or a label"}
      </button>
      <button type="button" className="ml-link" onClick={() => setEditing(editing === "new" ? null : "new")}>
        <Plus size={14} /> Add by hand
      </button>

      {error && (
        <div className="ml-error" role="alert">
          {error}
        </div>
      )}

      {editing === "new" && <MealForm initial={null} onDone={() => setEditing(null)} onSaved={refresh} />}

      <div className="ml-list">
        {preview && (
          <div className="ml-card ml-card--reading" aria-live="polite">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="ml-thumb" src={preview} alt="" />
            <div className="ml-card-main">
              <span className="ml-card-name">Reading your photo</span>
              <span className="ml-card-sub">Working out what&rsquo;s in it and how much</span>
            </div>
            <Loader2 size={18} className="spin" style={{ color: "var(--text-tertiary)" }} />
          </div>
        )}

        {meals.length === 0 && !preview && (
          <div className="ml-empty">
            <Camera size={26} strokeWidth={1.5} />
            <div>{day === today ? "Nothing logged yet today." : "Nothing logged this day."}</div>
            <div className="ml-hint">Snap your next meal or the label on a packet. It&rsquo;s read on the spot.</div>
          </div>
        )}

        {meals.map((m, idx) => (
          <MealCard
            key={m.id}
            m={m}
            n={idx + 1}
            open={open === m.id}
            nudge={justRead === m.id}
            editing={editing === m.id}
            pending={pending}
            onToggle={() => {
              setOpen(open === m.id ? null : m.id);
              if (justRead === m.id) setJustRead(null);
            }}
            onEdit={() => setEditing(m.id)}
            onEditDone={() => setEditing(null)}
            onDelete={() => {
              setOpen(null);
              act(() => deleteMealAction(m.id));
            }}
            onServings={(s) => act(() => setMealServingsAction(m.id, s))}
            onAddItem={(text) => act(() => addMealItemAction(m.id, text))}
            onRemoveItem={(i) => act(() => removeMealItemAction(m.id, i))}
            onGrams={(i, g) => act(() => setMealItemGramsAction(m.id, i, g))}
            onPhoto={() => setLightbox(m.id)}
            refresh={refresh}
          />
        ))}
      </div>

      <p className="ml-hint">A plate is an estimate; a label is read as printed. Open a meal to see what was counted, add what was missed and change any number.</p>

      {lightbox !== null && (
        <div className="ml-lightbox" role="dialog" aria-label="Photo" onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/app/meals/photo?meal=${lightbox}`} alt="" />
          <button type="button" aria-label="Close">
            <X size={20} />
          </button>
        </div>
      )}
    </div>
  );
}

function MealCard({
  m,
  n,
  open,
  nudge,
  editing,
  pending,
  onToggle,
  onEdit,
  onEditDone,
  onDelete,
  onServings,
  onAddItem,
  onRemoveItem,
  onGrams,
  onPhoto,
  refresh,
}: {
  m: MealView;
  n: number;
  open: boolean;
  nudge: boolean;
  editing: boolean;
  pending: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onEditDone: () => void;
  onDelete: () => void;
  onServings: (s: number) => void;
  onAddItem: (text: string) => void;
  onRemoveItem: (index: number) => void;
  onGrams: (index: number, grams: number) => void;
  onPhoto: () => void;
  refresh: () => void;
}) {
  const [addText, setAddText] = useState("");
  const [adding, setAdding] = useState(false);
  const [grams, setGrams] = useState<{ index: number; value: string } | null>(null);
  const addRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (nudge) addRef.current?.focus();
  }, [nudge]);

  async function add() {
    const t = addText.trim();
    if (!t) return;
    setAdding(true);
    try {
      await onAddItem(t);
      setAddText("");
    } finally {
      setAdding(false);
    }
  }

  const sub = [time(m.loggedAt), `P ${Math.round(m.protein)} · C ${Math.round(m.carbs)} · F ${Math.round(m.fat)}`, m.kind === "label" && m.servings !== 1 ? `${m.servings} servings` : null].filter(Boolean).join(" · ");

  return (
    <article className="ml-card" data-open={open}>
      <button type="button" className="ml-card-head" onClick={onToggle} aria-expanded={open}>
        <span className="ml-badge">M{n}</span>
        {m.hasPhoto && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="ml-thumb" src={`/api/app/meals/photo?meal=${m.id}`} alt="" loading="lazy" />
        )}
        <span className="ml-card-main">
          <span className="ml-card-name">{m.name}</span>
          <span className="ml-card-sub">{sub}</span>
        </span>
        <span className="ml-card-kcal">
          {Math.round(m.calories)}
          <small>kcal</small>
        </span>
        <ChevronDown size={16} className="ml-chev" />
      </button>

      {open && (
        <div className="ml-card-body">
          {editing ? (
            <MealForm initial={m} onDone={onEditDone} onSaved={refresh} />
          ) : (
            <>
              {nudge && (
                <div className="ml-nudge">
                  Anything on it I can&rsquo;t see? Seeds, a sauce, butter, oil, a drink. Add it below and the numbers update.
                </div>
              )}

              {m.items.length > 0 && (
                <div>
                  <div className="ml-h">What&rsquo;s in it</div>
                  <ul className="ml-items">
                    {m.items.map((it, i) => (
                      <li key={i}>
                        <div className="ml-item-main">
                          <span className="ml-item-name">{it.name}</span>
                          <span className="ml-item-sub">
                            {it.portion ? `${it.portion}` : null}
                            {it.grams ? (
                              grams?.index === i ? (
                                <form
                                  className="ml-grams"
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    const g = Number(grams.value);
                                    if (g > 0) onGrams(i, g);
                                    setGrams(null);
                                  }}
                                >
                                  <input className="ml-input ml-input--sm" inputMode="numeric" value={grams.value} onChange={(e) => setGrams({ index: i, value: e.target.value })} autoFocus aria-label="Grams" />
                                  <span>g</span>
                                  <button type="submit" className="ml-btn ml-btn--sm">
                                    Save
                                  </button>
                                  <button type="button" className="ml-link" onClick={() => setGrams(null)}>
                                    Cancel
                                  </button>
                                </form>
                              ) : (
                                <button type="button" className="ml-gramsbtn" onClick={() => setGrams({ index: i, value: String(it.grams) })} title="Change the weight">
                                  {it.portion ? " · " : ""}
                                  {it.grams} g <Pencil size={11} />
                                </button>
                              )
                            ) : null}
                          </span>
                        </div>
                        <span className="ml-item-kcal">
                          {it.calories}
                          <small>P {it.protein} · C {it.carbs} · F {it.fat}</small>
                        </span>
                        <button type="button" className="ml-x" aria-label={`Remove ${it.name}`} onClick={() => onRemoveItem(i)} disabled={pending}>
                          <X size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <form
                className="ml-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  void add();
                }}
              >
                <input ref={addRef} className="ml-input" placeholder={m.items.length ? "Missing something? e.g. a tablespoon of seeds" : "Add what's in it, e.g. 50 g oats"} value={addText} onChange={(e) => setAddText(e.target.value)} maxLength={200} disabled={adding} />
                <button type="submit" className="ml-btn ml-btn--sm" disabled={adding || !addText.trim()}>
                  {adding ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} {adding ? "Working it out" : "Add"}
                </button>
              </form>

              {m.kind === "label" && (
                <div className="ml-servings">
                  <span>Servings eaten</span>
                  <button type="button" aria-label="Fewer servings" onClick={() => onServings(m.servings - (m.servings > 1 ? 1 : 0.25))} disabled={pending || m.servings <= 0.25}>
                    <Minus size={14} />
                  </button>
                  <b>{m.servings}</b>
                  <button type="button" aria-label="More servings" onClick={() => onServings(m.servings < 1 ? m.servings + 0.25 : m.servings + 1)} disabled={pending || m.servings >= 20}>
                    <Plus size={14} />
                  </button>
                </div>
              )}

              {m.kind !== "manual" && (
                <details className="ml-why">
                  <summary>Why these numbers?</summary>
                  <p>
                    {CONFIDENCE[m.confidence ?? "medium"]}
                    {m.notes ? ` ${m.notes}` : ""}
                  </p>
                </details>
              )}

              <div className="ml-card-actions">
                {m.hasPhoto && (
                  <button type="button" className="ml-link" onClick={onPhoto}>
                    See the photo
                  </button>
                )}
                <span style={{ flex: 1 }} />
                <button type="button" className="ml-btn ml-btn--ghost ml-btn--sm" onClick={onEdit}>
                  <Pencil size={14} /> Edit
                </button>
                <button type="button" className="ml-btn ml-btn--ghost ml-btn--sm" onClick={onDelete} disabled={pending}>
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </article>
  );
}

/** Add a meal by hand, or correct one's totals. The meal keeps its M-number; the name is what it was. */
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
