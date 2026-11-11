"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Ask for a line of text (a reason). The result carries it. */
  prompt?: { label: string; placeholder?: string; minLength?: number };
  /** The operator must type this exact string before Confirm enables. */
  typeToConfirm?: string;
}
export type ConfirmResult = { ok: true; value: string } | { ok: false };

type Ask = (opts: ConfirmOptions) => Promise<ConfirmResult>;
const Ctx = createContext<Ask | null>(null);

interface Pending { opts: ConfirmOptions; resolve: (r: ConfirmResult) => void }

/**
 * One native <dialog> for the whole console. A browser confirm() cannot be
 * styled, cannot ask for a reason, and cannot make somebody type a name
 * before deleting a business. This can. Native <dialog> gives focus trapping,
 * Escape and the backdrop for free.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const ask = useCallback<Ask>((opts) => new Promise((resolve) => setPending({ opts, resolve })), []);
  const settle = (r: ConfirmResult) => {
    pending?.resolve(r);
    setPending(null);
  };
  return (
    <Ctx.Provider value={ask}>
      {children}
      {pending && <Dialog opts={pending.opts} onSettle={settle} />}
    </Ctx.Provider>
  );
}

export function useConfirm(): Ask {
  const ask = useContext(Ctx);
  if (!ask) throw new Error("useConfirm needs a ConfirmProvider above it");
  return ask;
}

function Dialog({ opts, onSettle }: { opts: ConfirmOptions; onSettle: (r: ConfirmResult) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [value, setValue] = useState("");
  const inputId = useId();
  const minLength = opts.prompt?.minLength ?? 3;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    d.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onSettle({ ok: false });
    };
    d.addEventListener("cancel", onCancel);
    return () => d.removeEventListener("cancel", onCancel);
  }, [onSettle]);

  const typeOk = opts.typeToConfirm === undefined || typed === opts.typeToConfirm;
  const promptOk = opts.prompt === undefined || value.trim().length >= minLength;
  const canConfirm = typeOk && promptOk;

  return (
    <dialog
      ref={ref}
      className="dlg"
      aria-labelledby={`${inputId}-title`}
      onClick={(e) => {
        if (e.target === ref.current) onSettle({ ok: false });
      }}
    >
      <form
        method="dialog"
        className="dlg-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (canConfirm) onSettle({ ok: true, value: value.trim() });
        }}
      >
        <h2 id={`${inputId}-title`} className="dlg-title">{opts.title}</h2>
        {opts.body && <p className="dlg-text">{opts.body}</p>}

        {opts.prompt && (
          <label className="dlg-field">
            <span>{opts.prompt.label}</span>
            <input
              className="input"
              autoFocus
              value={value}
              placeholder={opts.prompt.placeholder}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="off"
            />
          </label>
        )}

        {opts.typeToConfirm !== undefined && (
          <label className="dlg-field">
            <span>
              Type <strong>{opts.typeToConfirm}</strong> to confirm
            </span>
            <input
              className="input"
              autoFocus={!opts.prompt}
              value={typed}
              placeholder={opts.typeToConfirm}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}

        <div className="dlg-actions">
          <button type="button" className="btn btn--secondary btn--md" onClick={() => onSettle({ ok: false })}>
            {opts.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="submit"
            className={`btn btn--md ${opts.danger ? "btn--destructive" : "btn--primary"}`}
            disabled={!canConfirm}
            autoFocus={!opts.prompt && opts.typeToConfirm === undefined}
          >
            {opts.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
