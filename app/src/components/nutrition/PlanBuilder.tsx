"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { savePlanAction } from "@/app/nutrition/actions";
import {
  blankDay,
  blankFood,
  blankMeal,
  dayTotals,
  mealTotals,
  type DayInput,
  type FoodInput,
  type MealInput,
  type PlanInput,
} from "@/lib/nutritionModel";

type Variant = "full" | "per_meal" | "daily";

export function PlanBuilder({ initial }: { initial: PlanInput }) {
  const router = useRouter();
  const [plan, setPlan] = useState<PlanInput>(initial);
  const [dayIdx, setDayIdx] = useState(0);
  const [tagsText, setTagsText] = useState(initial.tags.join(", "));
  const [saving, start] = useTransition();

  const variant: Variant =
    plan.type === "full" ? "full" : plan.macroMode === "daily" ? "daily" : "per_meal";
  const withMeal = variant !== "daily";

  const idx = Math.min(dayIdx, plan.days.length - 1);
  const day = plan.days[idx];
  const totals = dayTotals(day, plan.type, plan.macroMode);

  // ── immutable updates ───────────────────────────────────────────────────────
  const mutateDay = (di: number, fn: (d: DayInput) => DayInput) =>
    setPlan((p) => ({ ...p, days: p.days.map((d, i) => (i === di ? fn(d) : d)) }));
  const setDay = (patch: Partial<DayInput>) => mutateDay(idx, (d) => ({ ...d, ...patch }));
  const setMeal = (mi: number, patch: Partial<MealInput>) =>
    mutateDay(idx, (d) => ({ ...d, meals: d.meals.map((m, j) => (j === mi ? { ...m, ...patch } : m)) }));
  const setFood = (mi: number, fi: number, patch: Partial<FoodInput>) =>
    mutateDay(idx, (d) => ({
      ...d,
      meals: d.meals.map((m, j) =>
        j === mi ? { ...m, foods: m.foods.map((f, k) => (k === fi ? { ...f, ...patch } : f)) } : m,
      ),
    }));

  const addDay = () => {
    setPlan((p) => ({ ...p, days: [...p.days, blankDay(`Day ${p.days.length + 1}`, withMeal)] }));
    setDayIdx(plan.days.length);
  };
  const duplicateDay = () => {
    const copy: DayInput = JSON.parse(JSON.stringify({ ...day, id: undefined, name: `${day.name} (copy)` }));
    setPlan((p) => ({ ...p, days: [...p.days, copy] }));
    setDayIdx(plan.days.length);
  };
  const removeDay = (di: number) => {
    if (plan.days.length <= 1) return;
    setPlan((p) => ({ ...p, days: p.days.filter((_, i) => i !== di) }));
    setDayIdx((v) => Math.max(0, v >= di ? v - 1 : v));
  };
  const addMeal = () => mutateDay(idx, (d) => ({ ...d, meals: [...d.meals, blankMeal(`Meal ${d.meals.length + 1}`)] }));
  const removeMeal = (mi: number) => mutateDay(idx, (d) => ({ ...d, meals: d.meals.filter((_, j) => j !== mi) }));
  const addFood = (mi: number) =>
    mutateDay(idx, (d) => ({
      ...d,
      meals: d.meals.map((m, j) => (j === mi ? { ...m, foods: [...m.foods, blankFood()] } : m)),
    }));
  const removeFood = (mi: number, fi: number) =>
    mutateDay(idx, (d) => ({
      ...d,
      meals: d.meals.map((m, j) => (j === mi ? { ...m, foods: m.foods.filter((_, k) => k !== fi) } : m)),
    }));

  const submit = (close: boolean) => {
    if (!plan.title.trim()) return toast.error("Give the plan a title.");
    start(async () => {
      const payload: PlanInput = {
        ...plan,
        tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
      };
      const res = await savePlanAction(payload);
      if (res.ok) {
        toast.success("Nutrition plan saved.");
        if (close) {
          router.push("/nutrition");
        } else {
          router.replace(`/nutrition/${res.id}`);
        }
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const heading =
    variant === "daily" ? "Totals for day" : variant === "per_meal" ? "Macro nutrition plan" : "Nutrition plan";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Button variant="ghost" size="icon" onClick={() => router.push("/nutrition")} aria-label="Back">
          <ArrowLeft size={16} />
        </Button>
        <h1 style={{ margin: 0, fontFamily: "var(--font-heading), sans-serif", fontSize: 24, textTransform: "uppercase" }}>
          {initial.id ? "Edit" : "Add"} {heading}
        </h1>
      </div>

      {/* title */}
      <div style={card}>
        <div>
          <Label htmlFor="pl-title">Title</Label>
          <Input
            id="pl-title"
            value={plan.title === "New Nutrition Plan" ? "" : plan.title}
            onChange={(e) => setPlan((p) => ({ ...p, title: e.target.value }))}
            placeholder="Enter nutrition plan title"
          />
        </div>

        {/* day tabs */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {plan.days.map((d, i) => {
            const active = i === idx;
            return (
              <div
                key={i}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "7px 12px",
                  borderRadius: "var(--radius)",
                  border: active ? "1px solid var(--accent)" : "1px solid var(--hairline)",
                  background: active ? "var(--accent-soft)" : "transparent",
                  cursor: "pointer",
                }}
                onClick={() => setDayIdx(i)}
              >
                <span style={{ fontSize: 13, color: active ? "var(--accent-ink)" : "var(--text-secondary)" }}>{d.name || `Day ${i + 1}`}</span>
                {plan.days.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeDay(i);
                    }}
                    aria-label="Remove day"
                    style={{ background: "transparent", border: "none", color: "var(--text-tertiary)", cursor: "pointer", display: "inline-flex" }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            );
          })}
          <Button variant="outline" size="sm" onClick={addDay}>
            <Plus size={14} /> Add New Day
          </Button>
          <Button variant="ghost" size="sm" onClick={duplicateDay}>
            <Copy size={14} /> Duplicate Day
          </Button>
        </div>

        {/* day name */}
        <div style={{ maxWidth: 420 }}>
          <Label htmlFor="day-name">Day name</Label>
          <Input id="day-name" value={day.name} onChange={(e) => setDay({ name: e.target.value })} />
        </div>

        {/* day totals */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <TotalCard label="Calories" value={totals.calories} unit="kcal" />
          <TotalCard label="Protein" value={totals.protein} unit="g" />
          <TotalCard label="Carbs" value={totals.carbs} unit="g" />
          <TotalCard label="Fat" value={totals.fat} unit="g" />
        </div>
      </div>

      {/* body */}
      {variant === "daily" ? (
        <div style={card}>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Enter the daily macro totals for {day.name}.</div>
          <MacroInputs
            protein={day.protein}
            carbs={day.carbs}
            fat={day.fat}
            calories={day.calories}
            onChange={(patch) => setDay(patch)}
          />
          <div>
            <Label htmlFor="day-notes">Notes</Label>
            <Textarea id="day-notes" value={day.notes ?? ""} onChange={(e) => setDay({ notes: e.target.value })} rows={3} />
          </div>
        </div>
      ) : (
        <>
          {day.meals.map((meal, mi) => (
            <div key={mi} style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Input
                  value={meal.name}
                  onChange={(e) => setMeal(mi, { name: e.target.value })}
                  placeholder="Meal name"
                  style={{ maxWidth: 280, fontWeight: 600 }}
                />
                <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-tertiary)", fontFamily: "var(--font-mono), monospace" }}>
                  {macroLine(mealTotals(meal, plan.type, plan.macroMode))}
                </div>
                <button
                  onClick={() => removeMeal(mi)}
                  aria-label="Remove meal"
                  style={{ background: "transparent", border: "none", color: "var(--text-tertiary)", cursor: "pointer" }}
                >
                  <Trash2 size={15} />
                </button>
              </div>

              {variant === "full" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ overflowX: "auto" }}>
                    <div style={{ minWidth: 720 }}>
                      <div style={{ ...foodRow, ...foodHead }}>
                        <div>Food</div>
                        <div>Qty</div>
                        <div>Unit</div>
                        <div style={{ textAlign: "right" }}>Protein</div>
                        <div style={{ textAlign: "right" }}>Carbs</div>
                        <div style={{ textAlign: "right" }}>Fat</div>
                        <div style={{ textAlign: "right" }}>Kcal</div>
                        <div />
                      </div>
                      {meal.foods.length === 0 && (
                        <div style={{ padding: "10px 4px", fontSize: 12.5, color: "var(--text-tertiary)" }}>
                          No foods yet — add one below.
                        </div>
                      )}
                      {meal.foods.map((food, fi) => (
                        <div key={fi} style={foodRow}>
                          <Input value={food.name} onChange={(e) => setFood(mi, fi, { name: e.target.value })} placeholder="e.g. Chicken breast" />
                          <NumCell value={food.quantity} onChange={(v) => setFood(mi, fi, { quantity: v })} />
                          <Input value={food.unit ?? ""} onChange={(e) => setFood(mi, fi, { unit: e.target.value })} placeholder="g" style={{ height: 34 }} />
                          <NumCell value={food.protein} onChange={(v) => setFood(mi, fi, { protein: v })} />
                          <NumCell value={food.carbs} onChange={(v) => setFood(mi, fi, { carbs: v })} />
                          <NumCell value={food.fat} onChange={(v) => setFood(mi, fi, { fat: v })} />
                          <NumCell value={food.calories} onChange={(v) => setFood(mi, fi, { calories: v })} />
                          <button
                            onClick={() => removeFood(mi, fi)}
                            aria-label="Remove food"
                            style={{ background: "transparent", border: "none", color: "var(--text-tertiary)", cursor: "pointer" }}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Button variant="ghost" size="sm" onClick={() => addFood(mi)}>
                      <Plus size={14} /> Add food
                    </Button>
                  </div>
                </div>
              ) : (
                <MacroInputs
                  protein={meal.protein}
                  carbs={meal.carbs}
                  fat={meal.fat}
                  calories={meal.calories}
                  onChange={(patch) => setMeal(mi, patch)}
                />
              )}

              <div>
                <Label htmlFor={`meal-notes-${mi}`}>Notes</Label>
                <Textarea
                  id={`meal-notes-${mi}`}
                  value={meal.notes ?? ""}
                  onChange={(e) => setMeal(mi, { notes: e.target.value })}
                  rows={2}
                  placeholder="Enter meal notes"
                />
              </div>
            </div>
          ))}

          <div>
            <Button variant="outline" onClick={addMeal}>
              <Plus size={15} /> Add another meal
            </Button>
          </div>
        </>
      )}

      {/* plan notes + tags */}
      <div style={card}>
        <div>
          <Label htmlFor="plan-notes">Plan notes</Label>
          <Textarea id="plan-notes" value={plan.notes ?? ""} onChange={(e) => setPlan((p) => ({ ...p, notes: e.target.value }))} rows={3} />
        </div>
        <div>
          <Label htmlFor="plan-tags">Tags</Label>
          <Input id="plan-tags" value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="e.g. cutting, high protein (comma separated)" />
        </div>
      </div>

      {/* save bar */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <Button variant="ghost" onClick={() => router.push("/nutrition")} disabled={saving}>
          Cancel
        </Button>
        <Button variant="outline" onClick={() => submit(false)} disabled={saving}>
          {saving ? "Saving…" : "Save Nutrition Plan"}
        </Button>
        <Button onClick={() => submit(true)} disabled={saving}>
          Save &amp; Close
        </Button>
      </div>
    </div>
  );
}

// ── bits ──────────────────────────────────────────────────────────────────────

function MacroInputs({
  protein,
  carbs,
  fat,
  calories,
  onChange,
}: {
  protein: number;
  carbs: number;
  fat: number;
  calories: number;
  onChange: (patch: { protein?: number; carbs?: number; fat?: number; calories?: number }) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
      <Field label="Protein" suffix="g" value={protein} onChange={(v) => onChange({ protein: v })} />
      <Field label="Carbs" suffix="g" value={carbs} onChange={(v) => onChange({ carbs: v })} />
      <Field label="Fat" suffix="g" value={fat} onChange={(v) => onChange({ fat: v })} />
      <Field label="Calories" suffix="kcal" value={calories} onChange={(v) => onChange({ calories: v })} />
    </div>
  );
}

function Field({
  label,
  suffix,
  value,
  onChange,
}: {
  label: string;
  suffix: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div style={{ position: "relative" }}>
        <Input type="number" min={0} step="any" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
        <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "var(--text-tertiary)" }}>
          {suffix}
        </span>
      </div>
    </div>
  );
}

function NumCell({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      min={0}
      step="any"
      value={value}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      style={{
        height: 34,
        width: "100%",
        textAlign: "right",
        padding: "0 8px",
        borderRadius: "var(--radius)",
        border: "1px solid var(--hairline)",
        background: "var(--surface-2)",
        color: "var(--text-primary)",
        fontSize: 12.5,
        fontFamily: "var(--font-mono), monospace",
      }}
    />
  );
}

function TotalCard({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div
      style={{
        flex: "1 1 120px",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        background: "var(--surface-2)",
        padding: "12px 14px",
        textAlign: "center",
      }}
    >
      <div style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: 22, color: "var(--text-primary)" }}>
        {Math.round(value)}
        <span style={{ fontSize: 12, color: "var(--text-tertiary)", marginLeft: 3 }}>{unit}</span>
      </div>
      <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-tertiary)", fontFamily: "var(--font-mono), monospace", marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

function macroLine(m: { protein: number; carbs: number; fat: number; calories: number }) {
  return `${Math.round(m.calories)} kcal · ${Math.round(m.protein)}P ${Math.round(m.carbs)}C ${Math.round(m.fat)}F`;
}

const card: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
  background: "var(--surface-1)",
  padding: 20,
};
const foodRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "2fr 0.7fr 0.9fr 0.9fr 0.9fr 0.9fr 0.9fr 32px",
  gap: 8,
  alignItems: "center",
  padding: "5px 0",
};
const foodHead: React.CSSProperties = {
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "var(--text-tertiary)",
  fontFamily: "var(--font-mono), monospace",
  paddingBottom: 4,
  borderBottom: "1px solid var(--hairline)",
};
