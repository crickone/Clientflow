"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/cn";

type ActionResult = { ok: boolean; error?: string };

export function ConfirmButton({
  label,
  action,
  confirm,
  slug,
  danger,
  className,
  redirectTo,
}: {
  label: string;
  /** A server action (typically `tenantAction.bind(null, …)`). */
  action: () => Promise<ActionResult>;
  /** When set, `window.confirm(confirm)` must pass before the action runs. */
  confirm?: string;
  /** Offboard variant: the user must type this exact slug to proceed. */
  slug?: string;
  danger?: boolean;
  className?: string;
  /** On a successful `{ok:true}`, navigate here (used by Offboard → /gyms). */
  redirectTo?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function onClick() {
    // Gate destructive actions before touching the server.
    if (slug !== undefined) {
      const typed = window.prompt(`Type the gym's slug "${slug}" to confirm.`);
      if (typed !== slug) return;
    } else if (confirm && !window.confirm(confirm)) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await action();
      if (!r.ok) {
        setError(r.error ?? "Action failed");
        return;
      }
      if (redirectTo) router.push(redirectTo);
    });
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        className={className ?? cn("btn", danger ? "btn--destructive" : "btn--secondary", "btn--sm")}
        onClick={onClick}
        disabled={pending}
        style={pending ? { opacity: 0.6, cursor: "wait" } : undefined}
      >
        {pending ? "Working…" : label}
      </button>
      {error && (
        <span role="alert" style={{ color: "var(--red)", fontSize: 11.5, maxWidth: 220 }}>
          {error}
        </span>
      )}
    </span>
  );
}
