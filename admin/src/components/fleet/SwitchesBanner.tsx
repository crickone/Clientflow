import Link from "next/link";

import { api } from "@/lib/api";
import type { FleetResponse } from "@/lib/types";

/**
 * A red strip above every console page while any platform switch is stopped.
 * Fail-soft: if the fleet cannot be read, nothing is shown.
 */
export async function SwitchesBanner() {
  let stopped: string[] = [];
  try {
    const { killSwitches } = await api<FleetResponse>("/fleet", { revalidate: 15, tags: ["fleet"] });
    stopped = (killSwitches ?? []).filter((s) => s.stopped).map((s) => s.label);
  } catch {
    return null;
  }
  if (stopped.length === 0) return null;

  const things = stopped.map((l, i) => (i === 0 ? l : l.toLowerCase())).join(" and ");
  return (
    <div className="switch-banner" role="status">
      <span>
        {things} {stopped.length === 1 ? "is" : "are"} stopped for every business.
      </span>
      <Link href="/switches">Open platform switches</Link>
    </div>
  );
}
