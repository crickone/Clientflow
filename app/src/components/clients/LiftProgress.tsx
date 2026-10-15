"use client";

import { useState } from "react";

import { TrendChart } from "@/components/bodyscans/TrendChart";
import type { LiftSummary } from "@/lib/trainingOverview";
import { signed } from "@/lib/trainingProgress";

function day(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });
}

/** One lift at a time: pick it, see its estimated one-rep max over every workout it was logged in. */
export function LiftProgress({ lifts }: { lifts: LiftSummary[] }) {
  const [key, setKey] = useState(lifts[0]?.key ?? "");
  const lift = lifts.find((l) => l.key === key) ?? lifts[0];
  if (!lift) return null;
  const first = lift.points[0];
  const last = lift.points[lift.points.length - 1];

  return (
    <div className="bs-chart lp">
      <div className="lp-head">
        <div className="bs-chart-label" style={{ marginBottom: 0 }}>Lift progress, estimated one-rep max</div>
        <label className="lp-pick">
          <span className="sr-only">Lift</span>
          <select value={lift.key} onChange={(e) => setKey(e.target.value)}>
            {lifts.map((l) => (
              <option key={l.key} value={l.key}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <TrendChart label={lift.name} unit="kg" points={lift.points.map((p) => ({ at: p.at, value: Math.round(p.e1rm * 2) / 2 }))} height={150} />
      <div className="lp-facts">
        <span>
          Best <b>{lift.best.weightKg} kg x {lift.best.reps}</b> on {day(lift.best.at)}
        </span>
        <span>
          Logged <b>{lift.sessions}</b> time{lift.sessions === 1 ? "" : "s"}
        </span>
        {lift.sessions > 1 && first && last ? (
          <span>
            Since {day(first.at)}: <b>{signed(Math.round(lift.change.kg * 2) / 2, " kg")}</b> ({signed(Math.round(lift.change.pct), "%")})
          </span>
        ) : (
          <span className="bs-muted">Log it again to see a line.</span>
        )}
      </div>
    </div>
  );
}
