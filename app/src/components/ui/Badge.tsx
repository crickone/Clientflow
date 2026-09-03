import * as React from "react";

interface Props extends React.HTMLAttributes<HTMLSpanElement> {
  colour?: string;
  /**
   * Legacy tones (amber/green/red) are kept as-is for existing call sites.
   * The semantic tones (success/info/warning/danger) resolve to the shared
   * `--success/--info/--warning/--danger` tokens — prefer these for new code.
   */
  tone?:
    | "neutral"
    | "amber"
    | "green"
    | "red"
    | "success"
    | "info"
    | "warning"
    | "danger";
  /** Render a leading status dot in the badge's ink colour. */
  dot?: boolean;
  /** Pulse the dot (for in-progress states like "Generating"). Implies `dot`. */
  pulse?: boolean;
}

// Inks brightened for the dark surface — the previous values (#b45309 / #047857 /
// #b91c1c) were light-theme inks and read as muddy dark-on-dark.
const tones: Record<NonNullable<Props["tone"]>, { bg: string; fg: string }> = {
  neutral: { bg: "var(--surface-2)", fg: "var(--text-secondary)" },
  amber: { bg: "rgba(251, 191, 36, 0.15)", fg: "#fbbf24" },
  green: { bg: "rgba(74, 222, 128, 0.15)", fg: "#4ade80" },
  red: { bg: "rgba(248, 113, 113, 0.15)", fg: "#f87171" },
  success: { bg: "var(--success-soft)", fg: "var(--success)" },
  info: { bg: "var(--info-soft)", fg: "var(--info)" },
  warning: { bg: "var(--warning-soft)", fg: "var(--warning)" },
  danger: { bg: "var(--danger-soft)", fg: "var(--danger)" },
};

export function Badge({ colour, tone = "neutral", dot, pulse, children, style, ...rest }: Props) {
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
      {(dot || pulse) && (
        <span
          className={pulse ? "badge-dot-pulse" : undefined}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "currentColor",
            flexShrink: 0,
          }}
        />
      )}
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
