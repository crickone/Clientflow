/**
 * Table state that lives in the URL. Sort, page and visible columns are
 * things a person wants to send to someone else ("look at past-due sorted
 * by renewal"), so they are query parameters, and a saved view is a link.
 */
export interface TableState {
  sort: string | null;
  dir: "asc" | "desc";
  page: number;
  cols: string[] | null;
}

export function readTableState(params: URLSearchParams, defaults: Partial<TableState> = {}): TableState {
  const sort = params.get("sort") || defaults.sort || null;
  const dirRaw = params.get("dir");
  const dir: "asc" | "desc" = dirRaw === "asc" || dirRaw === "desc" ? dirRaw : defaults.dir ?? "asc";
  const pageRaw = Number(params.get("page"));
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const colsRaw = params.get("cols");
  const cols = colsRaw ? colsRaw.split(",").filter(Boolean) : defaults.cols ?? null;
  return { sort, dir, page, cols };
}

export function writeTableState(params: URLSearchParams, state: TableState): URLSearchParams {
  const out = new URLSearchParams(params);
  for (const k of ["sort", "dir", "page", "cols"]) out.delete(k);
  if (state.sort) {
    out.set("sort", state.sort);
    out.set("dir", state.dir);
  }
  if (state.page > 1) out.set("page", String(state.page));
  if (state.cols) out.set("cols", state.cols.join(","));
  return out;
}

function compare(a: unknown, b: unknown): number {
  const an = a === null || a === undefined || a === "";
  const bn = b === null || b === undefined || b === "";
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/** Stable sort; empty values sink to the bottom in both directions. */
export function sortRows<T>(rows: T[], key: string | null, dir: "asc" | "desc", value: (row: T, key: string) => unknown): T[] {
  if (!key) return rows;
  return rows
    .map((row, i) => ({ row, i, v: value(row, key) }))
    .sort((x, y) => {
      const xn = x.v === null || x.v === undefined || x.v === "";
      const yn = y.v === null || y.v === undefined || y.v === "";
      if (xn || yn) return compare(x.v, y.v) || x.i - y.i;
      const c = compare(x.v, y.v);
      return (dir === "asc" ? c : -c) || x.i - y.i;
    })
    .map((x) => x.row);
}

export function paginate<T>(rows: T[], page: number, size: number) {
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), pages);
  const from = total === 0 ? 0 : (current - 1) * size + 1;
  const to = Math.min(total, current * size);
  return { rows: rows.slice((current - 1) * size, current * size), pages, page: current, from, to, total };
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[], columns: { key: string; label: string }[]): string {
  const head = columns.map((c) => csvCell(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(","));
  return [head, ...body].join("\r\n") + "\r\n";
}
