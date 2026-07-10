interface Props {
  initials: string;
  size?: number;
  colour?: string;
}

export function Avatar({ initials, size = 36, colour }: Props) {
  const bg = colour ?? "var(--surface-2)";
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "var(--radius)",
        background: bg,
        color: colour ? "#fff" : "var(--text-primary)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--font-mono), ui-monospace, monospace",
        fontSize: size * 0.4,
        fontWeight: 400,
        letterSpacing: "0.02em",
        flexShrink: 0,
        border: "1px solid var(--grid)",
      }}
    >
      {initials}
    </div>
  );
}
