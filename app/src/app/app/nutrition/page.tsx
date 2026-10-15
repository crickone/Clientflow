import Link from "next/link";
import { ChevronRight, Salad } from "lucide-react";

import { requireClientPage } from "@/lib/clientAuth";
import { assignedNutritionPlans } from "@/lib/clientApp";
import { dailyCalories, dailyTarget, mealsForDay, targetSource } from "@/lib/meals";
import { dayTotals } from "@/lib/mealsModel";
import { dateKey } from "@/lib/trainingProgress";
import { Card, PageTitle, SectionTitle } from "@/components/clientapp/ui";
import { MealLog, type MealView } from "@/components/clientapp/MealLog";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = { full: "Full plan", macro: "Macro plan", upload: "Document" };

function shiftDay(day: string, by: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}

/** What the client ate today (snapped or typed in), their target, and the plans their coach gave them. */
export default async function ClientNutritionPage({ searchParams }: { searchParams: { day?: string } }) {
  const { clientId } = requireClientPage();
  const today = dateKey(Date.now());
  const day = searchParams.day && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.day) && searchParams.day <= today ? searchParams.day : today;

  const rows = mealsForDay(clientId, day);
  const meals: MealView[] = rows.map((m) => ({
    id: m.id,
    loggedAt: m.loggedAt,
    name: m.name,
    calories: m.calories,
    protein: m.protein,
    carbs: m.carbs,
    fat: m.fat,
    kind: m.kind,
    servings: m.servings,
    confidence: m.confidence,
    notes: m.notes,
    hasPhoto: Boolean(m.photo),
    items: m.items,
  }));
  const totals = dayTotals(rows);
  const target = dailyTarget(clientId);
  const source = targetSource(clientId);
  const goalHref = "/app/goal";
  const weekDays = Array.from({ length: 7 }, (_, i) => shiftDay(day, i - 6));
  const perDay = dailyCalories(clientId, weekDays[0], weekDays[6]);
  const week = weekDays.map((d) => ({ day: d, calories: Math.round(perDay[d] ?? 0) }));
  const plans = assignedNutritionPlans(clientId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub="What you ate, and your plan">Nutrition</PageTitle>
      <MealLog day={day} today={today} meals={meals} totals={totals} target={target} source={source} goalHref={goalHref} week={week} />

      <div>
        <SectionTitle>Your plans</SectionTitle>
        {plans.length === 0 ? (
          <Card>
            <div style={{ fontSize: 13.5, color: "var(--text-secondary)", textAlign: "center", padding: "12px 0" }}>No nutrition plan yet. Your coach will add one.</div>
          </Card>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {plans.map((p) => (
              <Link key={p.id} href={`/app/nutrition/${p.id}`}>
                <Card style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
                  <span style={iconBox}>
                    <Salad size={18} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text-primary)" }}>{p.title}</div>
                    <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>{TYPE_LABEL[p.type] ?? p.type}</div>
                  </div>
                  <ChevronRight size={18} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const iconBox: React.CSSProperties = { width: 38, height: 38, borderRadius: 10, background: "var(--surface-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--accent-ink)", flexShrink: 0 };
