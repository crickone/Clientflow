import { WidgetEmpty } from "./WidgetEmpty";

export function TableView({
  columns,
  rows,
  empty,
}: {
  columns: { key: string; label: string; align?: "left" | "right" }[];
  rows: Record<string, string | number | null>[];
  empty: string;
}) {
  if (rows.length === 0) {
    return <WidgetEmpty text={empty} />;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: c.align ?? "left", padding: "6px 10px", color: "var(--text-tertiary)", fontWeight: 500, fontSize: 12, borderBottom: "1px solid var(--hairline)", whiteSpace: "nowrap" }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} style={{ textAlign: c.align ?? "left", padding: "7px 10px", color: "var(--text-primary)", borderBottom: "1px solid var(--hairline)", whiteSpace: "nowrap" }}>
                  {r[c.key] ?? "-"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
