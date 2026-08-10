"use client";

import { useId, useState, useTransition } from "react";
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
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const router = useRouter();
  const inputId = useId();

  function runAction() {
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

  function onClick() {
    // Gate destructive actions before touching the server.
    if (slug !== undefined) {
      // Reveal the inline type-to-confirm field instead of a silent
      // window.prompt — a mismatch here is visibly disabled, never a no-op.
      setConfirming(true);
      return;
    }
    if (confirm && !window.confirm(confirm)) return;
    runAction();
  }

  function onCancel() {
    setConfirming(false);
    setTyped("");
    setError(null);
  }

  function onConfirmTyped() {
    if (typed !== slug) return; // belt-and-braces — the button is disabled until this matches
    setConfirming(false);
    setTyped("");
    runAction();
  }

  if (slug !== undefined && confirming) {
    const matches = typed === slug;
    return (
      <span style={{ display: "inline-flex", flexDirection: "column", gap: 6, maxWidth: 260 }}>
        <label htmlFor={inputId} style={{ fontSize: 12, color: "var(--text-secondary)" }}>
          Type the slug <strong>{slug}</strong> to confirm.
        </label>
        <input
          id={inputId}
          type="text"
          className="input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches) onConfirmTyped();
            else if (e.key === "Escape") onCancel();
          }}
          placeholder={slug}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          style={{ fontSize: 13 }}
        />
        <span style={{ display: "inline-flex", gap: 8 }}>
          <button
            type="button"
            className={className ?? cn("btn", danger ? "btn--destructive" : "btn--secondary", "btn--sm")}
            onClick={onConfirmTyped}
            disabled={pending || !matches}
            style={pending || !matches ? { opacity: 0.6, cursor: pending ? "wait" : "not-allowed" } : undefined}
          >
            {pending ? "Working…" : label}
          </button>
          <button type="button" className="btn btn--secondary btn--sm" onClick={onCancel} disabled={pending}>
            Cancel
          </button>
        </span>
        {error && (
          <span role="alert" style={{ color: "var(--red)", fontSize: 11.5, maxWidth: 220 }}>
            {error}
          </span>
        )}
      </span>
    );
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
