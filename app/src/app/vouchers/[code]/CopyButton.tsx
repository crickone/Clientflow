"use client";

import { useState } from "react";

export function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked — fall through silently
    }
  };

  return (
    <button type="button" onClick={onClick} className="btn-ghost">
      {copied ? "Copied ✓" : "Copy code"}
      <style jsx>{`
        .btn-ghost {
          padding: 16px 28px;
          background: transparent;
          color: var(--ink);
          font-family: inherit;
          font-size: 12px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          font-weight: 500;
          border: 1px solid var(--ink);
          border-radius: 999px;
          cursor: pointer;
          transition: background 0.3s ease, color 0.3s ease;
        }
        .btn-ghost:hover {
          background: var(--ink);
          color: var(--paper);
        }
      `}</style>
    </button>
  );
}
