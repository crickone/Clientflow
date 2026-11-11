"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/cn";
import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

type ActionResult = { ok: boolean; error?: string };

/**
 * A button that runs a server action after the operator confirms in the
 * console's dialog. Success is a toast; a failure is a toast and stays
 * under the button as selectable text. `undo` turns the success toast into
 * one with an Undo that runs the inverse action.
 */
export function ConfirmButton({
  label,
  action,
  confirm,
  slug,
  danger,
  className,
  redirectTo,
  done,
  undo,
}: {
  label: string;
  /** A server action (typically `tenantAction.bind(null, …)`). */
  action: () => Promise<ActionResult>;
  /** Body text of the dialog. Without it the action runs on click. */
  confirm?: string;
  /** Offboard variant: the user must type this exact slug in the dialog. */
  slug?: string;
  danger?: boolean;
  className?: string;
  /** On a successful `{ok:true}`, navigate here (used by Offboard → /gyms). */
  redirectTo?: string;
  /** Toast text on success. */
  done?: string;
  /** The inverse action, offered on the success toast for ten seconds. */
  undo?: { label: string; action: () => Promise<ActionResult> };
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const ask = useConfirm();

  function runAction() {
    setError(null);
    startTransition(async () => {
      const r = await action();
      if (!r.ok) {
        setError(r.error ?? "Action failed");
        notify.fail(r.error ?? "Action failed");
        return;
      }
      const message = done ?? `${label}: done`;
      if (undo) {
        notify.undo(message, {
          label: undo.label,
          onUndo: () => {
            startTransition(async () => {
              const u = await undo.action();
              if (!u.ok) notify.fail(u.error ?? "Could not undo that");
              else notify.ok(`${undo.label}: done`);
              router.refresh();
            });
          },
        });
      } else {
        notify.ok(message);
      }
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  }

  async function onClick() {
    if (confirm === undefined && slug === undefined) {
      runAction();
      return;
    }
    const r = await ask({
      title: label,
      body: confirm,
      confirmLabel: label,
      danger,
      typeToConfirm: slug,
    });
    if (r.ok) runAction();
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
