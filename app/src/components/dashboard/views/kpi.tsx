import { KpiTile } from "./KpiTile";

export const kpi = (d: { value: string; sub?: string; delta?: number | null; accent?: boolean }) => (
  <KpiTile value={d.value} sub={d.sub} delta={d.delta} accent={d.accent} />
);
