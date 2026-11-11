import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/**
 * Shown to a business's admins on every page while Facebook has stopped
 * accepting the connection, or lead ads are waiting to be fetched
 * (lib/facebook/health.ts, lib/facebook/leadQueue.ts). Without it the only
 * sign was posts quietly failing.
 */
export function FacebookProblemBanner({ problem, waitingLeads }: { problem: string | null; waitingLeads: number }) {
  return (
    <div
      role="status"
      style={{
        background: "rgba(242,193,78,.12)",
        border: "1px solid rgba(242,193,78,.4)",
        borderRadius: "var(--radius)",
        padding: "10px 16px",
        margin: "0 0 16px",
        fontSize: 13.5,
        color: "var(--text-primary)",
        display: "flex",
        gap: 8,
      }}
    >
      <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>
        {problem
          ? `Facebook stopped accepting the connection to ${problem}. Posts, replies and lead ads are paused until you reconnect.`
          : `${waitingLeads === 1 ? "A Facebook lead is" : `${waitingLeads} Facebook leads are`} waiting to come in. They are kept and tried again automatically.`}{" "}
        <Link href="/settings/integrations/facebook" style={{ textDecoration: "underline" }}>
          {problem ? "Reconnect Facebook" : "Check Facebook"}
        </Link>
      </span>
    </div>
  );
}
