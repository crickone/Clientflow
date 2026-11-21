"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";

import { ACTIVITY_SORT_KEYS, bookingsDelta, sortActivity, type ActivitySortKey, type ActivityView } from "@/lib/activitySort";
import { fmtCents } from "@/lib/format";
import { relTime } from "@/lib/labels";
import { readTableState, writeTableState } from "@/lib/table";

const COLUMNS: { key: ActivitySortKey; label: string; right?: boolean }[] = [
  { key: "name", label: "Business" },
  { key: "setup", label: "Setup" },
  { key: "lastLogin", label: "Last login" },
  { key: "membersActive", label: "Members active", right: true },
  { key: "bookings", label: "Bookings", right: true },
  { key: "leads", label: "Leads", right: true },
  { key: "sales", label: "Sales", right: true },
  { key: "ai", label: "AI spend", right: true },
  { key: "problems", label: "Open problems", right: true },
];

const DASH = "-";
const num = (n: number | null) => (n === null ? DASH : String(n));
const eur = (c: number | null) => (c === null ? DASH : fmtCents(c));

function isKey(k: string | null): k is ActivitySortKey {
  return k !== null && (ACTIVITY_SORT_KEYS as string[]).includes(k);
}

/**
 * The "This week" table. It takes data only (a server component cannot hand a
 * client one a function), and `now` comes from the server so "2h ago" reads the
 * same on the server render and in the browser.
 */
export function ActivityTable({ views, now }: { views: ActivityView[]; now: number }) {
  return (
    <Suspense fallback={null}>
      <ActivityTableInner views={views} now={now} />
    </Suspense>
  );
}

function ActivityTableInner({ views, now }: { views: ActivityView[]; now: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const state = readTableState(params, { sort: "problems", dir: "desc" });
  const sortKey: ActivitySortKey = isKey(state.sort) ? state.sort : "problems";
  const sorted = sortActivity(views, sortKey, state.dir);

  function toggle(key: ActivitySortKey) {
    // A new column starts in the direction people expect: names A to Z, numbers biggest first.
    const next =
      sortKey === key
        ? { ...state, sort: key, dir: state.dir === "asc" ? ("desc" as const) : ("asc" as const) }
        : { ...state, sort: key, dir: key === "name" ? ("asc" as const) : ("desc" as const) };
    router.replace(`${pathname}?${writeTableState(params, { ...next, page: 1 }).toString()}`, { scroll: false });
  }

  if (sorted.length === 0) return <p className="dt-empty">No businesses yet.</p>;

  return (
    <div className="tbl-scroll">
      <table className="tbl activity-tbl">
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.key} style={c.right ? { textAlign: "right" } : undefined}>
                <button
                  type="button"
                  className="dt-sort"
                  onClick={() => toggle(c.key)}
                  aria-sort={sortKey === c.key ? (state.dir === "asc" ? "ascending" : "descending") : "none"}
                >
                  {c.label}
                  {sortKey === c.key && (state.dir === "asc" ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden />)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ row, problems, worst }) => {
            const delta = bookingsDelta(row);
            return (
              <tr key={row.tenantId}>
                <td>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                    <span className="biz-mark" aria-hidden style={{ width: 28, height: 28, borderRadius: 8, fontSize: 13 }}>
                      {row.name.trim().slice(0, 2).toUpperCase() || "?"}
                    </span>
                    <Link href={`/gyms/${row.tenantId}`} style={{ fontWeight: 600 }}>{row.name}</Link>
                  </span>
                </td>
                <td className="activity-num">{row.setup ? `${row.setup.done} / ${row.setup.total}` : DASH}</td>
                <td className="activity-num">{relTime(row.lastLoginAt, now)}</td>
                <td className="activity-num" style={{ textAlign: "right" }}>{num(row.membersActive7d)}</td>
                <td className="activity-num" style={{ textAlign: "right" }}>
                  {num(row.bookings7d)}
                  {delta !== null && delta !== 0 ? (
                    <span className={delta > 0 ? "activity-up" : "activity-down"}>
                      {delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`}
                    </span>
                  ) : null}
                </td>
                <td className="activity-num" style={{ textAlign: "right" }}>{num(row.leads7d)}</td>
                <td className="activity-num" style={{ textAlign: "right" }}>{eur(row.salesCents7d)}</td>
                <td className="activity-num" style={{ textAlign: "right" }}>{eur(row.aiCentsThisMonth)}</td>
                <td
                  className="activity-num"
                  style={{
                    textAlign: "right",
                    fontWeight: problems > 0 ? 600 : 400,
                    color: problems === 0 ? "var(--text-tertiary)" : worst === "bad" ? "var(--red)" : "var(--amber)",
                  }}
                >
                  {problems}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
