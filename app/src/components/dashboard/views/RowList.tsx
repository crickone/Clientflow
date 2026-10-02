import Link from "next/link";

export interface Row {
  id: string | number;
  primary: string;
  secondary?: string;
  meta?: string;
  href?: string;
}

export function RowList({ rows, empty }: { rows: Row[]; empty: string }) {
  if (rows.length === 0) {
    return <div style={{ padding: "16px 0", color: "var(--text-tertiary)", fontSize: 14 }}>{empty}</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((r) => {
        const body = (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "var(--text-secondary)", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.primary}
              </div>
              {r.secondary && <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 2 }}>{r.secondary}</div>}
            </div>
            {r.meta && <div style={{ color: "var(--text-tertiary)", fontSize: 11, whiteSpace: "nowrap" }}>{r.meta}</div>}
          </div>
        );
        return r.href ? (
          <Link key={r.id} href={r.href}>
            {body}
          </Link>
        ) : (
          <div key={r.id}>{body}</div>
        );
      })}
    </div>
  );
}
