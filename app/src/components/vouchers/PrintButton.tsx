"use client";

/** The gift page's Print button, for a buyer who gives the voucher in person. */
export function PrintButton({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.print()}>
      Print
    </button>
  );
}
