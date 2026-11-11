"use client";

import { useState, useTransition } from "react";

import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

type OpenResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Opening a client's account is the most sensitive thing this console does:
 * it is a real login to a real business's live data. The reason is asked for
 * HERE, before the action runs, because it is written to the audit log AND
 * shown in a banner inside the tenant app for the life of the session -- so
 * the client can see why someone was in their account.
 */

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
  /** A server action bound to a tenant id (`openTenant.bind(null, id)`), taking the reason. */
  action: (reason: string) => Promise<OpenResult>;
  label?: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ask = useConfirm();

  async function onClick() {
    setError(null);
    const r = await ask({
      title: "Open this business",
      body: "This is recorded, and shown to them in a banner while you are in there.",
      confirmLabel: "Open in a new tab",
      prompt: { label: "Why are you opening it?", placeholder: "Support call about…", minLength: 3 },
    });
    if (!r.ok) return;
    startTransition(async () => {
      const res = await action(r.value);
      if (!res.ok) {
        setError(res.error);
        notify.fail(res.error);
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
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
