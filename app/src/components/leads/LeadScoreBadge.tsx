import { band, BAND_LABEL, NEXT_STEPS, type NextStep } from "@/lib/leadScoreModel";

const R = 17;
const C = 2 * Math.PI * R;

/** A lead's score as a ring coloured by band (hot, warm, cold), the number inside; band and next step on hover. */
export function LeadScoreBadge({ score, next, size = "md" }: { score: number | null; next?: string | null; size?: "md" | "lg" }) {
  if (score === null || score === undefined) return null;
  const b = band(score);
  const step = next && next in NEXT_STEPS ? NEXT_STEPS[next as NextStep].label : null;
  const label = `${BAND_LABEL[b]} lead, score ${score} out of 100${step ? `. Next: ${step}` : ""}`;
  return (
    <span className="lsr" data-band={b} data-size={size} title={label} role="img" aria-label={label}>
      <svg viewBox="0 0 40 40" aria-hidden>
        <circle className="lsr-track" cx="20" cy="20" r={R} />
        <circle className="lsr-arc" cx="20" cy="20" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(2, score) / 100)} />
      </svg>
      <b aria-hidden>{score}</b>
    </span>
  );
}

/** The next step in words, coloured by band, for under a lead's name. */
export function LeadNextStep({ score, next }: { score: number | null; next?: string | null }) {
  if (score === null || score === undefined || !next || !(next in NEXT_STEPS)) return null;
  return (
    <span className="lc-next" data-band={band(score)}>
      {NEXT_STEPS[next as NextStep].label}
    </span>
  );
}
