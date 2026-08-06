import Link from "next/link";

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
      }}
    >
      ⚠ Your last subscription payment failed — we&apos;ll retry automatically.{" "}
      <Link href="/settings/billing" style={{ textDecoration: "underline" }}>
        Check your card
      </Link>{" "}
      to avoid interruption.
    </div>
  );
}
