"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { Input, Label } from "@/components/ui/Input";
import { deleteFoodAction, saveFoodAction } from "@/app/nutrition/foods/actions";
import type { FoodRow } from "@/lib/nutritionLibrary";

export function FoodsView({ foods }: { foods: FoodRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FoodRow | null>(null);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return foods;
    return foods.filter(
      (f) => f.name.toLowerCase().includes(query) || (f.category ?? "").toLowerCase().includes(query),
    );
  }, [foods, q]);

  const openCreate = () => {
    setEditing(null);
    setOpen(true);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>
          {foods.length} food{foods.length === 1 ? "" : "s"}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ position: "relative", width: 240 }}>
            <Search size={15} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" }} />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search foods…" style={{ paddingLeft: 32 }} />
          </div>
          <Button onClick={openCreate}>
            <Plus size={15} /> Add food
          </Button>
        </div>
      </div>

      <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 760 }}>
            <div style={{ ...row, ...headRow }}>
              <div>Food</div>
              <div>Serving</div>
              <div style={{ textAlign: "right" }}>Protein</div>
              <div style={{ textAlign: "right" }}>Carbs</div>
              <div style={{ textAlign: "right" }}>Fat</div>
              <div style={{ textAlign: "right" }}>Calories</div>
              <div style={{ textAlign: "right" }}>Actions</div>
            </div>
            {filtered.length === 0 && (
              <div style={{ padding: "36px 16px", textAlign: "center", color: "var(--text-tertiary)", fontSize: 13.5 }}>
                No foods yet. Click <strong>Add food</strong> to build your library.
              </div>
            )}
            {filtered.map((f) => (
              <div key={f.id} style={row}>
                <button
                  onClick={() => {
                    setEditing(f);
                    setOpen(true);
                  }}
                  style={{ textAlign: "left", background: "transparent", border: "none", cursor: "pointer", padding: 0, minWidth: 0 }}
                >
                  <div style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 500 }}>{f.name}</div>
                  {f.category && <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{f.category}</div>}
                </button>
                <div style={{ fontSize: 12.5, color: "var(--text-secondary)", fontFamily: "var(--font-mono), monospace" }}>
                  {round(f.servingSize)} {f.servingUnit}
                </div>
                <Cell v={f.protein} suffix="g" />
                <Cell v={f.carbs} suffix="g" />
                <Cell v={f.fat} suffix="g" />
                <Cell v={f.calories} suffix="" />
                <div style={{ textAlign: "right" }}>
                  <button
                    onClick={() => {
                      setEditing(f);
                      setOpen(true);
                    }}
                    aria-label="Edit"
                    style={iconBtn}
                  >
                    <Pencil size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <FoodSheet
        open={open}
        editing={editing}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          router.refresh();
        }}
      />
    </div>
  );
}

function FoodSheet({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: FoodRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [servingSize, setServingSize] = useState(100);
  const [servingUnit, setServingUnit] = useState("g");
  const [protein, setProtein] = useState(0);
  const [carbs, setCarbs] = useState(0);
  const [fat, setFat] = useState(0);
  const [calories, setCalories] = useState(0);

  const [seed, setSeed] = useState<number | "new" | null>(null);
  const key = editing ? editing.id : "new";
  if (open && seed !== key) {
    setSeed(key);
    setName(editing?.name ?? "");
    setCategory(editing?.category ?? "");
    setServingSize(editing?.servingSize ?? 100);
    setServingUnit(editing?.servingUnit ?? "g");
    setProtein(editing?.protein ?? 0);
    setCarbs(editing?.carbs ?? 0);
    setFat(editing?.fat ?? 0);
    setCalories(editing?.calories ?? 0);
  }
  if (!open && seed !== null) setSeed(null);

  const submit = () => {
    if (!name.trim()) return toast.error("Give the food a name.");
    start(async () => {
      const res = await saveFoodAction({
        id: editing?.id,
        name,
        category: category || null,
        servingSize,
        servingUnit,
        protein,
        carbs,
        fat,
        calories,
      });
      if (res.ok) {
        toast.success(editing ? "Food updated." : "Food added.");
        onSaved();
      } else toast.error(res.error);
    });
  };

  const remove = () => {
    if (!editing) return;
    start(async () => {
      await deleteFoodAction(editing.id);
      toast.success("Food deleted.");
      onSaved();
    });
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={editing ? "Edit food" : "Add food"} width={440}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <Label htmlFor="f-name">Name</Label>
            <Input id="f-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chicken breast" autoFocus />
          </div>
          <div>
            <Label htmlFor="f-cat">Category</Label>
            <Input id="f-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Protein" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <NumField label="Serving size" value={servingSize} onChange={setServingSize} />
            <div>
              <Label htmlFor="f-unit">Unit</Label>
              <Input id="f-unit" value={servingUnit} onChange={(e) => setServingUnit(e.target.value)} placeholder="g" />
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>Macros are per one serving above.</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <NumField label="Protein (g)" value={protein} onChange={setProtein} />
            <NumField label="Carbs (g)" value={carbs} onChange={setCarbs} />
            <NumField label="Fat (g)" value={fat} onChange={setFat} />
            <NumField label="Calories" value={calories} onChange={setCalories} />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 4 }}>
            {editing ? (
              <Button variant="ghost" onClick={remove} disabled={pending} aria-label="Delete food">
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
                {pending ? "Saving…" : editing ? "Save" : "Add food"}
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input type="number" min={0} step="any" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </div>
  );
}

function Cell({ v, suffix }: { v: number; suffix: string }) {
  return (
    <div style={{ textAlign: "right", fontFamily: "var(--font-mono), monospace", fontSize: 12.5, color: "var(--text-secondary)" }}>
      {round(v)}
      {suffix}
    </div>
  );
}
function round(n: number) {
  return Math.round(n * 10) / 10;
}

const row: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "2fr 1fr 0.9fr 0.9fr 0.9fr 1fr 0.7fr",
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
