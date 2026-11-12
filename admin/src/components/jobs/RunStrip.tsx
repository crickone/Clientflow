import { fmtDuration } from "@/lib/format";
import type { JobRun } from "@/lib/types";

/** Thirty cells, oldest left: green ok, red failed, grey running or interrupted. Title carries the detail. */
export function RunStrip({ runs }: { runs: JobRun[] }) {
  const cells = [...runs].reverse().slice(-30);
  return (
    <span className="runstrip" aria-label={`${cells.length} recent runs`}>
      {cells.map((r) => (
        <i
          key={r.id}
          className={r.ok === true ? "is-ok" : r.ok === false ? "is-fail" : "is-run"}
          title={`${new Date(r.startedAt).toLocaleString("en-IE")}: ${r.ok === true ? `ok in ${fmtDuration(r.durationMs)}` : r.ok === false ? r.error ?? "failed" : "running or interrupted"}`}
        />
      ))}
    </span>
  );
}
