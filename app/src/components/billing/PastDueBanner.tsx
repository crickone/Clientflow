import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export function PastDueBanner() {
  return (
    <div
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
        Your last subscription payment failed — we&apos;ll retry automatically.{" "}
        <Link href="/settings/billing" style={{ textDecoration: "underline" }}>
          Check your card
        </Link>{" "}
        to avoid interruption.
      </span>
    </div>
  );
}
