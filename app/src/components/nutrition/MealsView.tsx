"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { deleteMealAction, getMealAction, saveMealAction } from "@/app/nutrition/meals/actions";
import type { FoodRow, MealRow } from "@/lib/nutritionLibrary";
import type { Macros } from "@/lib/nutritionModel";

interface BuilderItem {
  key: number;
  foodId: number | null;
  name: string;
  quantity: number;
  unit: string | null;
  base: Macros; // per-serving macros; total = base × quantity
}

const ZERO: Macros = { protein: 0, carbs: 0, fat: 0, calories: 0 };
function scale(b: Macros, q: number): Macros {
  return { protein: b.protein * q, carbs: b.carbs * q, fat: b.fat * q, calories: b.calories * q };
}
function sum(items: BuilderItem[]): Macros {
  return items.reduce((acc, it) => {
    const t = scale(it.base, it.quantity);
    return {
      protein: acc.protein + t.protein,
      carbs: acc.carbs + t.carbs,
      fat: acc.fat + t.fat,
      calories: acc.calories + t.calories,
    };
  }, ZERO);
}
const r = (n: number) => Math.round(n);

export function MealsView({ meals, foods }: { meals: MealRow[]; foods: FoodRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return meals;
    return meals.filter(
      (m) => m.name.toLowerCase().includes(query) || (m.category ?? "").toLowerCase().includes(query),
    );
  }, [meals, q]);

  const openCreate = () => {
    setEditingId(null);
    setOpen(true);
  };
  const openEdit = (id: number) => {
    setEditingId(id);
    setOpen(true);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>
          {meals.length} meal{meals.length === 1 ? "" : "s"}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ position: "relative", width: 240 }}>
            <Search size={15} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" }} />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search meals…" style={{ paddingLeft: 32 }} />
          </div>
          <Button onClick={openCreate}>
            <Plus size={15} /> Create meal
          </Button>
        </div>
      </div>

      <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 720 }}>
            <div style={{ ...row, ...headRow }}>
              <div>Meal</div>
              <div style={{ textAlign: "right" }}>Foods</div>
              <div style={{ textAlign: "right" }}>Protein</div>
              <div style={{ textAlign: "right" }}>Carbs</div>
              <div style={{ textAlign: "right" }}>Fat</div>
              <div style={{ textAlign: "right" }}>Calories</div>
              <div style={{ textAlign: "right" }}>Actions</div>
            </div>
            {filtered.length === 0 && (
              <div style={{ padding: "36px 16px", textAlign: "center", color: "var(--text-tertiary)", fontSize: 13.5 }}>
                No meals yet. Click <strong>Create meal</strong> to build one from your foods.
              </div>
            )}
            {filtered.map((m) => (
              <div key={m.id} style={row}>
                <button
                  onClick={() => openEdit(m.id)}
                  style={{ textAlign: "left", background: "transparent", border: "none", cursor: "pointer", padding: 0, minWidth: 0 }}
                >
                  <div style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 500 }}>{m.name}</div>
                  {m.category && <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{m.category}</div>}
                </button>
                <Cell v={m.itemCount} />
                <Cell v={m.totals.protein} suffix="g" />
                <Cell v={m.totals.carbs} suffix="g" />
                <Cell v={m.totals.fat} suffix="g" />
                <Cell v={m.totals.calories} />
                <div style={{ textAlign: "right" }}>
                  <button onClick={() => openEdit(m.id)} aria-label="Edit" style={iconBtn}>
                    <Pencil size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <MealSheet
        open={open}
        editingId={editingId}
        foods={foods}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          router.refresh();
        }}
      />
    </div>
  );
}

function MealSheet({
  open,
  editingId,
  foods,
  onClose,
  onSaved,
}: {
  open: boolean;
  editingId: number | null;
  foods: FoodRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<BuilderItem[]>([]);
  const [foodQ, setFoodQ] = useState("");
  const keyRef = useRef(1);
  const nextKey = () => keyRef.current++;

  // (re)seed the form whenever the sheet opens for a given target
  const [seed, setSeed] = useState<number | "new" | null>(null);
  const target = editingId ?? "new";
  if (open && seed !== target) {
    setSeed(target);
    setFoodQ("");
    if (editingId == null) {
      setName("");
      setCategory("");
      setNotes("");
      setItems([]);
    } else {
      setLoading(true);
      getMealAction(editingId).then((m) => {
        setLoading(false);
        if (!m) return;
        setName(m.name);
        setCategory(m.category ?? "");
        setNotes(m.notes ?? "");
        setItems(
          m.items.map((it) => {
            const q = it.quantity || 1;
            return {
              key: nextKey(),
              foodId: it.foodId,
              name: it.name,
              quantity: it.quantity,
              unit: it.unit,
              base: {
                protein: it.protein / q,
                carbs: it.carbs / q,
                fat: it.fat / q,
                calories: it.calories / q,
              },
            };
          }),
        );
      });
    }
  }
  if (!open && seed !== null) setSeed(null);

  const totals = sum(items);
  const foodMatches = useMemo(() => {
    const query = foodQ.trim().toLowerCase();
    if (!query) return [];
    return foods.filter((f) => f.name.toLowerCase().includes(query)).slice(0, 8);
  }, [foodQ, foods]);

  const addFood = (f: FoodRow) => {
    setItems((prev) => [
      ...prev,
      {
        key: nextKey(),
        foodId: f.id,
        name: f.name,
        quantity: 1,
        unit: f.servingUnit,
        base: { protein: f.protein, carbs: f.carbs, fat: f.fat, calories: f.calories },
      },
    ]);
    setFoodQ("");
  };
  const addCustom = () =>
    setItems((prev) => [
      ...prev,
      { key: nextKey(), foodId: null, name: "", quantity: 1, unit: "serving", base: { ...ZERO } },
    ]);
  const patch = (key: number, p: Partial<BuilderItem>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...p } : it)));
  const patchBase = (key: number, p: Partial<Macros>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, base: { ...it.base, ...p } } : it)));
  const removeItem = (key: number) => setItems((prev) => prev.filter((it) => it.key !== key));

  const submit = () => {
    if (!name.trim()) return toast.error("Give the meal a name.");
    start(async () => {
      const res = await saveMealAction({
        id: editingId ?? undefined,
        name,
        category: category || null,
        notes: notes || null,
        items: items
          .filter((it) => it.name.trim())
          .map((it) => {
            const t = scale(it.base, it.quantity);
            return {
              foodId: it.foodId,
              name: it.name,
              quantity: it.quantity,
              unit: it.unit,
              protein: t.protein,
              carbs: t.carbs,
              fat: t.fat,
              calories: t.calories,
            };
          }),
      });
      if (res.ok) {
        toast.success(editingId ? "Meal updated." : "Meal created.");
        onSaved();
      } else toast.error(res.error);
    });
  };

  const remove = () => {
    if (editingId == null) return;
    start(async () => {
      await deleteMealAction(editingId);
      toast.success("Meal deleted.");
      onSaved();
    });
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={editingId ? "Edit meal" : "Create meal"} width={560}>
        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>Loading…</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
              <div>
                <Label htmlFor="m-name">Name</Label>
                <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chicken & rice" autoFocus />
              </div>
              <div>
                <Label htmlFor="m-cat">Category</Label>
                <Input id="m-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Lunch" />
              </div>
            </div>

            {/* totals */}
            <div style={{ display: "flex", gap: 8 }}>
              <Total label="Kcal" v={totals.calories} />
              <Total label="Protein" v={totals.protein} unit="g" />
              <Total label="Carbs" v={totals.carbs} unit="g" />
              <Total label="Fat" v={totals.fat} unit="g" />
            </div>

            {/* food search */}
            <div style={{ position: "relative" }}>
              <Label>Add food</Label>
              <Input
                value={foodQ}
                onChange={(e) => setFoodQ(e.target.value)}
                placeholder={foods.length ? "Search your foods…" : "No foods yet — add a custom item below"}
              />
              {foodQ.trim() && (
                <div style={dropdown}>
                  {foodMatches.map((f) => (
                    <button key={f.id} onClick={() => addFood(f)} style={dropItem}>
                      <span style={{ fontSize: 13, color: "var(--text-primary)" }}>{f.name}</span>
                      <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--text-tertiary)", fontFamily: "var(--font-mono), monospace" }}>
                        {r(f.calories)} kcal / {r(f.servingSize)}{f.servingUnit}
                      </span>
                    </button>
                  ))}
                  {foodMatches.length === 0 && (
                    <div style={{ padding: 10, fontSize: 12.5, color: "var(--text-tertiary)" }}>No matches.</div>
                  )}
                </div>
              )}
            </div>

            {/* items */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {items.length === 0 && (
                <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", padding: "4px 0" }}>
                  No foods added yet.
                </div>
              )}
              {items.map((it) => {
                const t = scale(it.base, it.quantity);
                const custom = it.foodId == null;
                return (
                  <div key={it.key} style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {custom ? (
                        <Input value={it.name} onChange={(e) => patch(it.key, { name: e.target.value })} placeholder="Food name" style={{ height: 32 }} />
                      ) : (
                        <span style={{ flex: 1, fontSize: 13.5, color: "var(--text-primary)", fontWeight: 500 }}>{it.name}</span>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={it.quantity}
                          onChange={(e) => patch(it.key, { quantity: Number(e.target.value) || 0 })}
                          style={qtyInput}
                          aria-label="Quantity"
                        />
                        <span style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>× {it.unit ?? "serving"}</span>
                      </div>
                      <button onClick={() => removeItem(it.key)} aria-label="Remove" style={{ background: "transparent", border: "none", color: "var(--text-tertiary)", cursor: "pointer" }}>
                        <X size={14} />
                      </button>
                    </div>
                    {custom ? (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                        <MiniNum label="P" value={it.base.protein} onChange={(v) => patchBase(it.key, { protein: v })} />
                        <MiniNum label="C" value={it.base.carbs} onChange={(v) => patchBase(it.key, { carbs: v })} />
                        <MiniNum label="F" value={it.base.fat} onChange={(v) => patchBase(it.key, { fat: v })} />
                        <MiniNum label="Kcal" value={it.base.calories} onChange={(v) => patchBase(it.key, { calories: v })} />
                      </div>
                    ) : (
                      <div style={{ fontSize: 11.5, color: "var(--text-secondary)", fontFamily: "var(--font-mono), monospace" }}>
                        {r(t.calories)} kcal · {r(t.protein)}P {r(t.carbs)}C {r(t.fat)}F
                      </div>
                    )}
                  </div>
                );
              })}
              <div>
                <Button variant="ghost" size="sm" onClick={addCustom}>
                  <Plus size={14} /> Add custom food
                </Button>
              </div>
            </div>

            <div>
              <Label htmlFor="m-notes">Notes</Label>
              <Textarea id="m-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 4 }}>
              {editingId != null ? (
                <Button variant="ghost" onClick={remove} disabled={pending} aria-label="Delete meal">
                  <Trash2 size={14} />
                </Button>
              ) : (
                <span />
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <Button variant="ghost" onClick={onClose} disabled={pending}>
                  Cancel
                </Button>
                <Button onClick={submit} disabled={pending}>
                  {pending ? "Saving…" : editingId ? "Save meal" : "Create meal"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function MiniNum({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ position: "relative" }}>
      <input
        type="number"
        min={0}
        step="any"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        style={{ ...qtyInput, width: "100%", textAlign: "left", paddingLeft: 8, paddingRight: 34 }}
        aria-label={label}
      />
      <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 10.5, color: "var(--text-tertiary)" }}>{label}</span>
    </div>
  );
}

function Total({ label, v, unit }: { label: string; v: number; unit?: string }) {
  return (
    <div style={{ flex: 1, border: "1px solid var(--hairline)", borderRadius: "var(--radius)", background: "var(--surface-2)", padding: "8px 10px", textAlign: "center" }}>
      <div style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: 17, color: "var(--text-primary)" }}>
        {r(v)}
        {unit && <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{unit}</span>}
      </div>
      <div style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-tertiary)", fontFamily: "var(--font-mono), monospace" }}>{label}</div>
    </div>
  );
}

function Cell({ v, suffix }: { v: number; suffix?: string }) {
  return (
    <div style={{ textAlign: "right", fontFamily: "var(--font-mono), monospace", fontSize: 12.5, color: "var(--text-secondary)" }}>
      {Math.round(v)}
      {suffix ?? ""}
    </div>
  );
}

const row: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "2fr 0.7fr 0.9fr 0.9fr 0.9fr 1fr 0.7fr",
  gap: 12,
  padding: "11px 16px",
  borderBottom: "1px solid var(--hairline)",
  alignItems: "center",
  fontSize: 13,
};
const headRow: React.CSSProperties = {
  background: "var(--surface-1)",
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-tertiary)",
  fontFamily: "var(--font-mono), monospace",
};
const iconBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 30,
  height: 30,
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "transparent",
  color: "var(--text-secondary)",
  cursor: "pointer",
};
const dropdown: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  right: 0,
  zIndex: 20,
  background: "var(--surface-1)",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
  boxShadow: "0 8px 28px rgba(0,0,0,0.28)",
  overflow: "hidden",
  maxHeight: 260,
  overflowY: "auto",
};
const dropItem: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  textAlign: "left",
  padding: "8px 12px",
  background: "transparent",
  border: "none",
  borderBottom: "1px solid var(--hairline)",
  cursor: "pointer",
};
const qtyInput: React.CSSProperties = {
  width: 64,
  height: 32,
  textAlign: "right",
  padding: "0 8px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "var(--surface-2)",
  color: "var(--text-primary)",
  fontSize: 12.5,
  fontFamily: "var(--font-mono), monospace",
};
