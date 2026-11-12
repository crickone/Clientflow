"use client";

import type { ReactNode } from "react";

/** Appears above a table when rows are selected. */
export function BulkBar({ count, onClear, children }: { count: number; onClear: () => void; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="bulk" role="region" aria-label="Bulk actions">
      <span className="bulk-count">{count} selected</span>
      <span className="bulk-actions">{children}</span>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onClear}>Clear</button>
    </div>
  );
}
