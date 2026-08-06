"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as React from "react";

import { Button } from "./Button";

export type ConfirmOptions = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<ConfirmFn | null>(null);

/**
 * Themed replacement for `window.confirm()`. Usage:
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "Delete X?", destructive: true }))) return;
 * Radix Dialog gives focus-trap, Escape, and aria for free.
 */
export function useConfirm(): ConfirmFn {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<{
    opts: ConfirmOptions;
    resolve: (v: boolean) => void;
  } | null>(null);

  const confirm = React.useCallback<ConfirmFn>(
    (opts) => new Promise<boolean>((resolve) => setState({ opts, resolve })),
    [],
  );

  const settle = (result: boolean) => {
    setState((s) => {
      s?.resolve(result);
      return null;
    });
  };

  const opts = state?.opts;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <DialogPrimitive.Root open={!!state} onOpenChange={(o) => { if (!o) settle(false); }}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(10,10,10,0.32)",
              backdropFilter: "blur(6px)",
              WebkitBackdropFilter: "blur(6px)",
              zIndex: 80,
              animation: "fade-up 0.18s var(--ease)",
            }}
          />
          <DialogPrimitive.Content
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "min(94vw, 420px)",
              background: "var(--bg)",
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius)",
              boxShadow: "var(--shadow-2)",
              zIndex: 90,
              padding: 24,
              animation: "fade-up 0.22s var(--ease)",
            }}
          >
            <DialogPrimitive.Title
              style={{
                fontFamily: "var(--font-heading), sans-serif",
                fontSize: 19,
                fontWeight: 400,
                textTransform: "uppercase",
                color: "var(--text-primary)",
                marginBottom: opts?.body ? 8 : 22,
                lineHeight: 1.15,
              }}
            >
              {opts?.title ?? ""}
            </DialogPrimitive.Title>
            {opts?.body && (
              <DialogPrimitive.Description style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 22, lineHeight: 1.5 }}>
                {opts.body}
              </DialogPrimitive.Description>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <Button variant="ghost" size="sm" onClick={() => settle(false)}>
                {opts?.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                variant={opts?.destructive ? "destructive" : "primary"}
                size="sm"
                onClick={() => settle(true)}
              >
                {opts?.confirmLabel ?? (opts?.destructive ? "Delete" : "Confirm")}
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </ConfirmContext.Provider>
  );
}
