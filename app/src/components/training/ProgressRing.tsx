interface Props {
  value: number;
  max?: number;
  size?: number;
  label?: string;
}

export function ProgressRing({ value, max = 100, size = 64, label }: Props) {
  const pct = max === 0 ? 0 : Math.min(1, value / max);
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * pct;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--hairline)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--text-primary)"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${dash} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray 0.4s var(--ease)" }}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily="var(--font-heading), sans-serif"
          fontSize={size * 0.28}
          fill="var(--text-primary)"
        >
          {Math.round(pct * 100)}%
        </text>
      </svg>
      {label && (
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{label}</span>
      )}
    </div>
  );
}
