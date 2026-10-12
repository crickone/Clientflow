import type { ReactNode } from "react";
import { ChartNoAxesColumn } from "lucide-react";

/**
 * A chart with nothing to plot: says so, and says what will fill it, rather
 * than drawing flat axes or a lone grey line of text.
 */
export function ChartEmpty({ height, title, body, icon }: { height: number; title: string; body: string; icon?: ReactNode }) {
  return (
    <div className="chart-empty" style={{ height }}>
      <span className="chart-empty-icon" aria-hidden>
        {icon ?? <ChartNoAxesColumn size={18} />}
      </span>
      <div className="chart-empty-title">{title}</div>
      <p className="chart-empty-body">{body}</p>
    </div>
  );
}
