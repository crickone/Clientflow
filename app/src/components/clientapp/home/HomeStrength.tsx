// app/src/components/clientapp/home/HomeStrength.tsx
/**
 * Overall strength on Home: the big change, the line the Progress page draws,
 * and what it is the average of. With too little to draw it is one quiet row.
 */
import { PkCard, PkSection, QuietRow } from "@/components/clientapp/programs/kit";
import { TrendChart } from "@/components/bodyscans/TrendChart";
import type { StrengthTrend } from "./homeModel";

export function HomeStrength({ trend }: { trend: StrengthTrend | null }) {
  if (!trend) return <QuietRow href="/app/progress" label="Log a lift twice to see your strength trend" icon="chevron" />;
  return (
    <PkSection label="Overall strength">
      <PkCard href="/app/progress">
        <b className="pk-schart-value">{trend.value}</b>
        <TrendChart label="Strength" unit="%" points={trend.points} height={96} />
        <span className="pk-small">Average estimated max across your main lifts</span>
      </PkCard>
    </PkSection>
  );
}
