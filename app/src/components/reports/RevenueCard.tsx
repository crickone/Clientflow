"use client";

import { useState } from "react";

import { CardLabel } from "@/components/ui/Card";
import { RevenueLine } from "@/components/charts/RevenueLine";
import { ChartEmpty } from "@/components/charts/ChartEmpty";

type Series = { day: string; total: number }[];

/**
 * Revenue two ways, one switch: money taken (every payment, online sales
 * included, the day it was paid) and revenue earned (sessions done).
 * They differ when people pay ahead: a Black Friday massage bought today is
 * cash now and earned when it's done.
 */
export function RevenueCard({ cash, earned }: { cash: Series; earned: Series }) {
  const [view, setView] = useState<"cash" | "earned">("cash");
  const data = view === "cash" ? cash : earned;
  const empty = !data.some((d) => d.total > 0);
  return (
    <>
      <div className="rv-head">
        <CardLabel>{view === "cash" ? "Cash taken" : "Earned from sessions done"}</CardLabel>
        <div className="ch-seg rv-seg" role="radiogroup" aria-label="Revenue view">
          <button type="button" role="radio" aria-checked={view === "cash"} onClick={() => setView("cash")}>
            Cash taken
          </button>
          <button type="button" role="radio" aria-checked={view === "earned"} onClick={() => setView("earned")}>
            Earned
          </button>
        </div>
      </div>
      {empty ? (
        <ChartEmpty
          height={260}
          title={view === "cash" ? "No payments in this period" : "No sessions done in this period"}
          body={view === "cash" ? "Every payment shows here the day it's taken, including online sales." : "Revenue shows here when a session is marked done."}
        />
      ) : (
        <RevenueLine data={data} height={260} />
      )}
    </>
  );
}
