"use client";

import { useState } from "react";

import { Card, DocumentCard, PageTitle, SectionTitle } from "@/components/clientapp/ui";
import { DayTabs } from "@/components/clientapp/DayTabs";
import {
  dayTotals,
  mealTotals,
  roundMacros,
  PLAN_TYPE_LABEL,
  type DayInput,
  type MacroMode,
  type Macros,
  type MealInput,
  type PlanInput,
  type PlanType,
} from "@/lib/nutritionModel";

/**
 * The full, read-only render of an assigned nutrition plan for the client
 * app — days → meals → foods (type "full"), or macro targets per day/meal
 * (type "macro"), or a link to the attached document (type "upload"). Fed by
 * `getPlan()` (the same tenant-DB assembly the admin PlanBuilder edits),
 * ownership-checked upstream in lib/clientApp.ts's
 * assignedNutritionPlanDetail — this component itself trusts its `plan` prop
 * completely and does no auth of its own.
 */
export function NutritionPlanDetail({ plan }: { plan: PlanInput }) {
  const [dayIdx, setDayIdx] = useState(0);
  const day: DayInput | undefined = plan.days[dayIdx];

  const typeLabel =
    plan.type === "macro"
      ? `${PLAN_TYPE_LABEL.macro} · ${plan.macroMode === "daily" ? "Daily totals" : "Per meal"}`
      : PLAN_TYPE_LABEL[plan.type];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub={typeLabel}>{plan.title}</PageTitle>

      {plan.type === "upload" ? (
        <DocumentCard href={`/api/app/nutrition/file?plan=${plan.id}`} name={plan.uploadOriginalName ?? plan.title} />
      ) : plan.days.length === 0 ? (
        <Card>
          <div style={emptyStyle}>This plan has no days yet — check back once your coach fills it in.</div>
        </Card>
      ) : (
        <>
          <DayTabs labels={plan.days.map((d, i) => d.name || `Day ${i + 1}`)} active={dayIdx} onChange={setDayIdx} />

          {day && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {plan.type === "macro" && plan.macroMode === "daily" && (
                <MacroStatCard macros={roundMacros(dayTotals(day, plan.type, plan.macroMode))} />
              )}

              {day.notes && (
                <Card>
                  <div style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{day.notes}</div>
                </Card>
              )}

              {day.meals.length === 0
                ? !(plan.type === "macro" && plan.macroMode === "daily") && (
                    <Card>
                      <div style={emptyStyle}>No meals added for this day yet.</div>
                    </Card>
                  )
                : day.meals.map((meal, mi) => (
                    <MealCard key={mi} meal={meal} type={plan.type} macroMode={plan.macroMode} />
                  ))}
            </div>
          )}
        </>
      )}

      {plan.notes && (
        <div>
          <SectionTitle>Notes from your coach</SectionTitle>
          <Card>
            <div style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{plan.notes}</div>
          </Card>
        </div>
      )}
    </div>
  );
}

function MealCard({ meal, type, macroMode }: { meal: MealInput; type: PlanType; macroMode: MacroMode | null }) {
  const showMacros = type === "full" || (type === "macro" && macroMode === "per_meal");
  const totals = roundMacros(mealTotals(meal, type, macroMode));
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text-primary)" }}>{meal.name}</div>
        {showMacros && <MacroChip macros={totals} />}
      </div>
      {meal.notes && <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>{meal.notes}</div>}
      {meal.foods.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {meal.foods.map((f, fi) => (
            <div key={fi} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: "var(--radius)", background: "var(--surface-2)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: "var(--text-primary)" }}>{f.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>
                  {f.quantity} {f.unit ?? ""}
                </div>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", flexShrink: 0 }}>{Math.round(f.calories)} kcal</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function MacroStatCard({ macros }: { macros: Macros }) {
  return (
    <Card style={{ padding: 18 }}>
      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-tertiary)", fontFamily: "var(--font-mono), monospace", marginBottom: 12 }}>
        Daily targets
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        <Stat label="Kcal" value={macros.calories} />
        <Stat label="Protein" value={macros.protein} unit="g" />
        <Stat label="Carbs" value={macros.carbs} unit="g" />
        <Stat label="Fat" value={macros.fat} unit="g" />
      </div>
    </Card>
  );
}

function Stat({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <div>
      <div style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: 19, color: "var(--text-primary)" }}>
        {value}
        {unit ?? ""}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{label}</div>
    </div>
  );
}

function MacroChip({ macros }: { macros: Macros }) {
  return (
    <span style={{ fontSize: 11.5, color: "var(--text-tertiary)", whiteSpace: "nowrap", flexShrink: 0 }}>
      {macros.calories} kcal · {macros.protein}P {macros.carbs}C {macros.fat}F
    </span>
  );
}

const emptyStyle: React.CSSProperties = { fontSize: 13.5, color: "var(--text-secondary)", textAlign: "center", padding: "16px 0" };
