"use client";

import { Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Download } from "lucide-react";

import { paginate, readTableState, sortRows, toCsv, writeTableState, type TableState } from "@/lib/table";

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  align?: "left" | "right";
  width?: number | string;
  /** Can be hidden from the column picker. Default true. */
  hideable?: boolean;
  /** The value to sort and export by. Defaults to row[key]. */
  value?: (row: T) => unknown;
  /** The CSV cell for this column. Defaults to the sort value. */
  csv?: (row: T) => string | number;
  render?: (row: T) => ReactNode;
}

/**
 * Every list in the console: sortable headers, pages, a column picker and a
 * CSV export, with the state in the URL. Rows are already loaded (the lists
 * here are hundreds, not millions); a list that needs server paging keeps
 * its own cursor and passes one page in.
 */
export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  pageSize?: number;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  csvName?: string;
  empty: string;
  selectable?: boolean;
  selected?: Set<string | number>;
  onSelect?: (next: Set<string | number>) => void;
  rowStyle?: (row: T) => CSSProperties | undefined;
}

/** useSearchParams needs a Suspense boundary or static pages fail to build. */
export function DataTable<T>(props: DataTableProps<T>) {
  return (
    <Suspense fallback={null}>
      <DataTableInner {...props} />
    </Suspense>
  );
}

function DataTableInner<T>({
  rows,
  columns,
  rowKey,
  pageSize = 25,
  defaultSort,
  csvName,
  empty,
  selectable,
  selected,
  onSelect,
  rowStyle,
}: DataTableProps<T>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const state = readTableState(params, defaultSort ? { sort: defaultSort.key, dir: defaultSort.dir } : {});
  const [picker, setPicker] = useState(false);
  const pickerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!picker) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPicker(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPicker(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [picker]);

  const valueOf = (row: T, key: string) => {
    const col = columns.find((c) => c.key === key);
    return col?.value ? col.value(row) : (row as Record<string, unknown>)[key];
  };

  const visible = columns.filter((c) => !state.cols || state.cols.includes(c.key) || c.hideable === false);
  const sorted = sortRows(rows, state.sort, state.dir, valueOf);
  const page = paginate(sorted, state.page, pageSize);

  function push(next: TableState) {
    router.replace(`${pathname}?${writeTableState(params, next).toString()}`, { scroll: false });
  }
  function toggleSort(key: string) {
    if (state.sort === key) push({ ...state, dir: state.dir === "asc" ? "desc" : "asc", page: 1 });
    else push({ ...state, sort: key, dir: "asc", page: 1 });
  }
  function toggleCol(key: string) {
    const current = visible.map((c) => c.key);
    if (current.includes(key)) {
      // Keep at least one hideable column: an empty list reads back as "all".
      const hideableShown = visible.filter((c) => c.hideable !== false);
      if (hideableShown.length <= 1) return;
    }
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    push({ ...state, cols: next.length === columns.length ? null : next });
  }
  function exportCsv() {
    const csv = toCsv(
      sorted.map((r) => Object.fromEntries(visible.map((c) => [c.key, c.csv ? c.csv(r) : valueOf(r, c.key)]))),
      visible.map((c) => ({ key: c.key, label: c.label })),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${csvName ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const allOnPage = page.rows.map(rowKey);
  const allSelected = selectable && allOnPage.length > 0 && allOnPage.every((k) => selected?.has(k));

  return (
    <div className="dt">
      <div className="dt-bar">
        <span className="dt-count">
          {page.total === 0 ? "" : page.total <= pageSize ? `${page.total} ${page.total === 1 ? "row" : "rows"}` : `${page.from} to ${page.to} of ${page.total}`}
        </span>
        <span className="dt-tools">
          <span ref={pickerRef} style={{ position: "relative" }}>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPicker((p) => !p)} aria-expanded={picker}>
              <Columns3 size={14} strokeWidth={1.75} aria-hidden /> Columns
            </button>
            {picker && (
              <div className="dt-picker" role="group" aria-label="Columns">
                {columns.filter((c) => c.hideable !== false).map((c) => (
                  <label key={c.key}>
                    <input type="checkbox" checked={visible.some((v) => v.key === c.key)} onChange={() => toggleCol(c.key)} /> {c.label}
                  </label>
                ))}
              </div>
            )}
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={exportCsv} disabled={sorted.length === 0}>
            <Download size={14} strokeWidth={1.75} aria-hidden /> CSV
          </button>
        </span>
      </div>

      {page.total === 0 ? (
        <p className="dt-empty">{empty}</p>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              {selectable && (
                <th style={{ width: 1 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={Boolean(allSelected)}
                    onChange={() => {
                      const next = new Set(selected);
                      if (allSelected) allOnPage.forEach((k) => next.delete(k));
                      else allOnPage.forEach((k) => next.add(k));
                      onSelect?.(next);
                    }}
                  />
                </th>
              )}
              {visible.map((c) => (
                <th key={c.key} style={{ width: c.width, textAlign: c.align }}>
                  {c.sortable ? (
                    <button type="button" className="dt-sort" onClick={() => toggleSort(c.key)} aria-sort={state.sort === c.key ? (state.dir === "asc" ? "ascending" : "descending") : "none"}>
                      {c.label}
                      {state.sort === c.key && (state.dir === "asc" ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden />)}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row) => {
              const k = rowKey(row);
              return (
                <tr key={k} style={rowStyle?.(row)} className={selected?.has(k) ? "is-selected" : undefined}>
                  {selectable && (
                    <td>
                      <input
                        type="checkbox"
                        aria-label="Select row"
                        checked={Boolean(selected?.has(k))}
                        onChange={() => {
                          const next = new Set(selected);
                          if (next.has(k)) next.delete(k);
                          else next.add(k);
                          onSelect?.(next);
                        }}
                      />
                    </td>
                  )}
                  {visible.map((c) => (
                    <td key={c.key} style={{ textAlign: c.align }}>
                      {c.render ? c.render(row) : String(valueOf(row, c.key) ?? "")}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {page.pages > 1 && (
        <div className="dt-pager">
          <button type="button" className="btn btn--ghost btn--sm" disabled={page.page <= 1} onClick={() => push({ ...state, page: page.page - 1 })} aria-label="Previous page">
            <ChevronLeft size={14} aria-hidden />
          </button>
          <span>
            Page {page.page} of {page.pages}
          </span>
          <button type="button" className="btn btn--ghost btn--sm" disabled={page.page >= page.pages} onClick={() => push({ ...state, page: page.page + 1 })} aria-label="Next page">
            <ChevronRight size={14} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
