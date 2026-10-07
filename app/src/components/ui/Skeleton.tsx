import * as React from "react";

/** A loading placeholder with a soft light sweep (.skeleton in globals.css). */
export function Skeleton({
  width = "100%",
  height = 16,
  style,
}: { width?: number | string; height?: number | string; style?: React.CSSProperties }) {
  return (
    <span
      className="skeleton"
      style={{
        display: "inline-block",
        width,
        height,
        borderRadius: "var(--radius)",
        ...style,
      }}
    />
  );
}

/**
 * The shape of a dashboard tile while its data streams in: a figure and a
 * caption for small tiles, a few rows for the larger ones, so the grid holds
 * its layout instead of popping.
 */
export function WidgetSkeleton({ rows = false }: { rows?: boolean }) {
  if (rows) {
    return (
      <div aria-hidden style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 2 }}>
        {[72, 54, 64].map((w, i) => (
          <Skeleton key={i} width={`${w}%`} height={12} style={{ borderRadius: 6 }} />
        ))}
      </div>
    );
  }
  return (
    <div aria-hidden style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 2 }}>
      <Skeleton width={84} height={30} style={{ borderRadius: 8 }} />
      <Skeleton width="58%" height={11} style={{ borderRadius: 6 }} />
    </div>
  );
}
