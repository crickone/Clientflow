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
    // Sits inside a widget card, so no panel of its own; tighter rows for a small card.
    <div
      style={
        {
          overflowX: "auto",
          "--dt-pad-x": "10px",
          "--dt-row-y": "9px",
          "--dt-head-y": "8px",
        } as React.CSSProperties
      }
    >
      <table className="dt">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === "right" ? "dt-num" : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} className={c.align === "right" ? "dt-num dt-nowrap" : "dt-nowrap"}>
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
