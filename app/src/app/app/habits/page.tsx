import { redirect } from "next/navigation";

import { requireClientPage } from "@/lib/clientAuth";
import { memberHabits } from "@/lib/habits";
import { PageTitle, SectionTitle } from "@/components/clientapp/ui";
import { HabitTicks } from "@/components/clientapp/HabitTicks";
import { HabitGrid } from "@/components/clientapp/HabitGrid";

export const dynamic = "force-dynamic";

/** Today's habits to tick, the streak, and the last four weeks. */
export default async function HabitsPage() {
  const { clientId } = requireClientPage();
  const h = memberHabits(clientId);
  if (!h) redirect("/app");
  const rate = Math.round((h.days.reduce((s, d) => s + d.done, 0) / Math.max(1, h.days.reduce((s, d) => s + d.total, 0))) * 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageTitle sub="Tick each one off as you go">{h.title}</PageTitle>
      <HabitTicks habits={h.habits} ticked={[...h.tickedToday]} day={h.today} streak={h.streak} />
      <div>
        <SectionTitle>Last four weeks</SectionTitle>
        <HabitGrid days={h.days} today={h.today} />
        <p style={{ margin: "8px 2px 0", fontSize: 12.5, color: "var(--text-tertiary)" }}>
          {rate}% of your habits done over the last four weeks. A full day is every habit ticked.
        </p>
      </div>
    </div>
  );
}
