import Link from "next/link";

export interface StatRow {
  label: string;
  /** The window or basis of the figure ("Last 30 days"), so two counts never seem to disagree. */
  sub: string;
  value: string;
  href?: string;
}

/** A figure that is nothing yet: greyed out, so the ones that matter stand out. */
const isZero = (v: string) => /^[^\d]*0(?:[.,]0+)?$/.test(v.trim());

/** Several related figures in one tile, one row each: label and window left, value right. */
export function StatList({ rows }: { rows: StatRow[] }) {
  return (
    <div className="stat-list">
      {rows.map((r) => {
        const inner = (
          <>
            <span className="stat-text">
              <span className="stat-label">{r.label}</span>
              <span className="stat-sub">{r.sub}</span>
            </span>
            <span className={isZero(r.value) ? "stat-value stat-value--zero" : "stat-value"}>{r.value}</span>
          </>
        );
        return r.href ? (
          <Link key={r.label} href={r.href} className="stat-row">
            {inner}
          </Link>
        ) : (
          <div key={r.label} className="stat-row">
            {inner}
          </div>
        );
      })}
    </div>
  );
}
