"use client";

import type { CSSProperties } from "react";

/** The gift page's Print button, for a buyer who gives the voucher in person. */
export function PrintButton({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <button type="button" className={className} style={style} onClick={() => window.print()}>
      Print
    </button>
  );
}
