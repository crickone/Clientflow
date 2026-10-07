import { KpiTile } from "./KpiTile";

export const kpi = (d: {
  value: string;
  sub?: string;
  delta?: number | null;
  accent?: boolean;
  goodWhen?: "up" | "down";
  spark?: number[];
}) => <KpiTile value={d.value} sub={d.sub} delta={d.delta} accent={d.accent} goodWhen={d.goodWhen} spark={d.spark} />;
