import { ShieldAlert } from "lucide-react";

/**
 * Shown on every page of a session that platform staff opened from the
 * console, for the whole life of that session.
 *
 * The point is that nobody mistakes it for the client's own login: not the
 * staff member two tabs deep in someone else's account, and not the client
 * watching over a shoulder on a call. It states plainly whose account this
 * is, who opened it, and why, because the reason was required at the console
 * and a reason nobody sees is just a form field.
 */
export function ImpersonationBanner({
  businessName,
  reason,
}: {
  businessName: string;
  reason: string | null;
}) {
  return (
    <div
      role="status"
      style={{
        background: "rgba(232,93,36,.12)",
        border: "1px solid rgba(232,93,36,.45)",
        borderRadius: "var(--radius)",
        padding: "10px 16px",
        margin: "0 0 16px",
        fontSize: 13.5,
        color: "var(--text-primary)",
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
      }}
    >
      <ShieldAlert size={15} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>
        <strong>Staff access.</strong> You are working inside {businessName}&rsquo;s account from the
        platform console. Anything you change here is their live data.
        {reason ? (
          <>
            {" "}
            Reason given: &ldquo;{reason}&rdquo;.
          </>
        ) : null}
      </span>
    </div>
  );
}
