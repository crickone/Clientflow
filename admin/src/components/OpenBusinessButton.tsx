"use client";

import { useState, useTransition } from "react";

type OpenResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * "Open business": calls a server action that mints a one-time login URL
 * (`openTenant` in gyms/[id]/actions.ts) and, on success, opens it in a NEW
 * TAB — the admin keeps the console tab and gets the client app alongside
 * it. Deliberately not a `<ConfirmButton redirectTo=…>`: that component
 * navigates the CURRENT tab via `router.push`, which is wrong here (the
 * returned URL is a different origin carrying a single-use token — the
 * console itself must never navigate away from it).
 */
export function OpenBusinessButton({
  action,
  label = "Open",
  className,
}: {
  /** A server action bound to a tenant id (`openTenant.bind(null, id)`). */
  action: () => Promise<OpenResult>;
  label?: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const r = await action();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      window.open(r.url, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        className={className ?? "btn btn--secondary btn--sm"}
        onClick={onClick}
        disabled={pending}
        style={pending ? { opacity: 0.6, cursor: "wait" } : undefined}
      >
        {pending ? "Opening…" : label}
      </button>
      {error && (
        <span role="alert" style={{ color: "var(--red)", fontSize: 11.5, maxWidth: 220 }}>
          {error}
        </span>
      )}
    </span>
  );
}
