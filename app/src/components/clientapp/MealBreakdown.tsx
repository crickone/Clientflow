"use client";

import { useState } from "react";
import { Loader2, Pencil, Scissors, X } from "lucide-react";

import { itemsTotal, looksMixed, per100, unaccounted, type MealItem, type MealTotals } from "@/lib/mealsModel";

type Patch = { name: string; grams: number | null; calories: number; protein: number; carbs: number; fat: number };

/**
 * How a meal's numbers were worked out, item by item: the weight, the
 * figure per 100 g it was scaled from, and what that comes to. Every line
 * can be changed; a new weight rescales the line, and any number can be
 * typed over. The total is the items plus anything no item accounts for.
 */
export function MealBreakdown({
  items,
  meal,
  pending,
  onSave,
  onRemove,
  onSplit,
}: {
  items: MealItem[];
  meal: MealTotals;
  pending: boolean;
  onSave: (index: number, patch: Patch) => Promise<boolean>;
  onRemove: (index: number) => void;
  onSplit: (index: number) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [splitting, setSplitting] = useState<number | null>(null);
  async function split(i: number) {
    setSplitting(i);
    try {
      await onSplit(i);
    } finally {
      setSplitting(null);
    }
  }
  const rest = unaccounted(meal, items);

  return (
    <div className="mb">
      <div className="ml-h">How it was worked out</div>
      <ul className="mb-list">
        {items.map((it, i) =>
          editing === i ? (
            <li key={i} className="mb-row mb-row--edit">
              <ItemEditor
                item={it}
                onRemove={() => {
                  setEditing(null);
                  onRemove(i);
                }}
                onSplit={() => {
                  setEditing(null);
                  void split(i);
                }}
                onCancel={() => setEditing(null)}
                onSave={async (p) => {
                  if (await onSave(i, p)) setEditing(null);
                }}
                pending={pending}
              />
            </li>
          ) : (
            <li key={i} className="mb-row">
              <button type="button" className="mb-main" onClick={() => setEditing(i)} aria-label={`Change ${it.name}`}>
                <span className="mb-top">
                  <span className="mb-name">{it.name}</span>
                  <span className="mb-kcal">
                    {it.calories}
                    <small> kcal</small>
                  </span>
                  <Pencil size={12} className="mb-pen" aria-hidden />
                </span>
                {it.portion && <span className="mb-portion">{it.portion}</span>}
                <span className="mb-calc">{calcLine(it)}</span>
                <span className="mb-macros">
                  P {it.protein} g · C {it.carbs} g · F {it.fat} g
                </span>
              </button>
              {looksMixed(it.name) && (
                <button type="button" className="mb-split" onClick={() => void split(i)} disabled={pending || splitting !== null}>
                  {splitting === i ? <Loader2 size={13} className="spin" /> : <Scissors size={13} />}
                  {splitting === i ? "Splitting into ingredients" : "Split into ingredients"}
                </button>
              )}
            </li>
          ),
        )}
        {rest && (
          <li className="mb-row mb-row--rest">
            <span className="mb-main mb-main--static">
              <span className="mb-top">
                <span className="mb-name">Not split out</span>
                <span className="mb-kcal">
                  {rest.calories}
                  <small> kcal</small>
                </span>
              </span>
              <span className="mb-calc">Oil, a sauce or dressing the photo couldn&rsquo;t separate, and rounding.</span>
              <span className="mb-macros">
                P {rest.protein} g · C {rest.carbs} g · F {rest.fat} g
              </span>
            </span>
          </li>
        )}
      </ul>
      <div className="mb-total">
        <span>Total</span>
        <span className="mb-total-macros">
          P {Math.round(meal.protein)} · C {Math.round(meal.carbs)} · F {Math.round(meal.fat)}
        </span>
        <b>{Math.round(meal.calories)} kcal</b>
      </div>
      {!rest && items.length > 1 && <p className="mb-note">The items add up to the total: {itemsTotal(items).calories} kcal.</p>}
    </div>
  );
}

function calcLine(it: MealItem): string {
  const p = per100(it);
  if (!p || !it.grams) return "Weight not known: numbers are for the whole portion";
  return `${it.grams} g at ${p.calories} kcal per 100 g`;
}

function ItemEditor({
  item,
  onSave,
  onCancel,
  onRemove,
  onSplit,
  pending,
}: {
  item: MealItem;
  onSave: (p: Patch) => void;
  onCancel: () => void;
  onRemove: () => void;
  onSplit: () => void;
  pending: boolean;
}) {
  const base = per100(item);
  const [v, setV] = useState({
    name: item.name,
    grams: item.grams ? String(item.grams) : "",
    calories: String(item.calories),
    protein: String(item.protein),
    carbs: String(item.carbs),
    fat: String(item.fat),
  });

  // A new weight rescales the line from its per-100 g figure; a typed number stays as typed.
  function setGrams(g: string) {
    const n = Number(g);
    if (base && n > 0) {
      const k = n / 100;
      setV({ ...v, grams: g, calories: String(Math.round(base.calories * k)), protein: String(Math.round(base.protein * k)), carbs: String(Math.round(base.carbs * k)), fat: String(Math.round(base.fat * k)) });
    } else setV({ ...v, grams: g });
  }
  const f = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  return (
    <form
      className="mb-edit"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          name: v.name,
          grams: v.grams.trim() ? Number(v.grams) : null,
          calories: Number(v.calories),
          protein: Number(v.protein),
          carbs: Number(v.carbs),
          fat: Number(v.fat),
        });
      }}
    >
      <label className="mb-f mb-f--wide">
        <span>Food</span>
        <input className="ml-input ml-input--sm" value={v.name} onChange={f("name")} maxLength={80} autoFocus />
      </label>
      <label className="mb-f">
        <span>Weight (g)</span>
        <input className="ml-input ml-input--sm" inputMode="numeric" value={v.grams} onChange={(e) => setGrams(e.target.value)} placeholder="unknown" />
      </label>
      <label className="mb-f">
        <span>kcal</span>
        <input className="ml-input ml-input--sm" inputMode="numeric" value={v.calories} onChange={f("calories")} />
      </label>
      <label className="mb-f">
        <span>Protein (g)</span>
        <input className="ml-input ml-input--sm" inputMode="numeric" value={v.protein} onChange={f("protein")} />
      </label>
      <label className="mb-f">
        <span>Carbs (g)</span>
        <input className="ml-input ml-input--sm" inputMode="numeric" value={v.carbs} onChange={f("carbs")} />
      </label>
      <label className="mb-f">
        <span>Fat (g)</span>
        <input className="ml-input ml-input--sm" inputMode="numeric" value={v.fat} onChange={f("fat")} />
      </label>
      <p className="mb-hint">{base ? `Was ${base.calories} kcal per 100 g. Change the weight and the rest follows, or type over any number.` : "Type the numbers from the packet, or your best guess."}</p>
      <div className="mb-edit-actions">
        <button type="submit" className="ml-btn ml-btn--sm" disabled={pending}>
          Save
        </button>
        <button type="button" className="ml-link" onClick={onCancel}>
          Cancel
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="ml-link" onClick={onSplit} disabled={pending}>
          <Scissors size={13} /> Split
        </button>
        <button type="button" className="ml-link mb-remove" onClick={onRemove} disabled={pending}>
          <X size={13} /> Remove
        </button>
      </div>
    </form>
  );
}
