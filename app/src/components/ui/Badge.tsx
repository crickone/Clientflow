import * as React from "react";

interface Props extends React.HTMLAttributes<HTMLSpanElement> {
  colour?: string;
  tone?: "neutral" | "amber" | "green" | "red";
}

const tones: Record<NonNullable<Props["tone"]>, { bg: string; fg: string }> = {
  neutral: { bg: "var(--surface-2)", fg: "var(--text-secondary)" },
  amber: { bg: "rgba(217, 119, 6, 0.12)", fg: "#b45309" },
  green: { bg: "rgba(16, 185, 129, 0.12)", fg: "#047857" },
  red: { bg: "rgba(220, 38, 38, 0.12)", fg: "#b91c1c" },
};

export function Badge({ colour, tone = "neutral", children, style, ...rest }: Props) {
  const palette = colour
    ? { bg: hexToRgba(colour, 0.14), fg: colour }
    : tones[tone];
  return (
    <span
      {...rest}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: "var(--radius)",
        background: palette.bg,
        color: palette.fg,
        fontFamily: "var(--font-mono), ui-monospace, monospace",
        fontSize: 10,
        fontWeight: 400,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

function hexToRgba(hex: string, alpha: number) {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
