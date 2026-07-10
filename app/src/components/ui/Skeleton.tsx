import * as React from "react";

export function Skeleton({
  width = "100%",
  height = 16,
  style,
}: { width?: number | string; height?: number | string; style?: React.CSSProperties }) {
  return (
    <span
      style={{
        display: "inline-block",
        width,
        height,
        borderRadius: "var(--radius)",
        background:
          "linear-gradient(90deg, var(--surface-1), var(--surface-2), var(--surface-1))",
        backgroundSize: "200% 100%",
        animation: "skeleton 1.4s infinite",
        ...style,
      }}
    />
  );
}
