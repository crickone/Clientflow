"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Collapsible titled section for the Content Studio editors. Groups a set of
 * related controls under one header so the editor reads as Content / Style /
 * Layout instead of one flat wall of inputs. Defaults open — collapsing is for
 * focus, nothing is hidden by default.
 */
export function EditorSection({
  title,
  hint,
  defaultOpen = true,
  children,
}: {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "13px 16px",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text-primary)",
          textAlign: "left",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-heading), sans-serif",
            fontSize: 13.5,
            fontWeight: 600,
            letterSpacing: "0.01em",
          }}
        >
          {title}
        </span>
        {hint && (
          <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{hint}</span>
        )}
        <ChevronDown
          size={16}
          style={{
            marginLeft: "auto",
            color: "var(--text-tertiary)",
            transform: open ? "none" : "rotate(-90deg)",
            transition: "transform 0.2s var(--ease)",
          }}
        />
      </button>
      {open && (
        <div
          style={{
            padding: "2px 16px 18px",
            display: "grid",
            gap: 16,
            borderTop: "1px solid var(--hairline)",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
