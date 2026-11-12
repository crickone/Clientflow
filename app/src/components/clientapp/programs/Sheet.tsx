// app/src/components/clientapp/programs/Sheet.tsx
"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The focusable elements inside a node, in tab order. */
function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[hidden]"));
}

/**
 * A bottom sheet for the Programs screens. It traps focus while open, closes
 * on Escape or a tap on the backdrop, stops the page behind it scrolling,
 * and gives focus back to whatever opened it.
 */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;
  // Read during the first render, before any child effect or autofocus moves focus, so it is the real trigger.
  const [opener] = useState(() => (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)));

  useEffect(() => {
    const root = ref.current;
    if (root) (focusables(root)[0] ?? root).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const items = focusables(ref.current);
      if (items.length === 0) return void e.preventDefault();
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !ref.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !ref.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [opener]);

  return (
    <div className="pk-sheet-backdrop" onClick={() => close.current()}>
      <div ref={ref} className="pk-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="pk-grip" aria-hidden />
        <div className="pk-sheet-head">
          <h2 id={titleId} className="pk-sheet-title">
            {title}
          </h2>
          <button type="button" className="pk-icon" aria-label="Close" onClick={() => close.current()}>
            <X size={18} />
          </button>
        </div>
        <div className="pk-sheet-body">{children}</div>
        {footer && <div className="pk-sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}
