import { band, BAND_LABEL, NEXT_STEPS, type NextStep } from "@/lib/leadScoreModel";

/** A lead's score as a small pill: the number, coloured by band, with the band and next step on hover. */
export function LeadScoreBadge({ score, next, size = "sm" }: { score: number | null; next?: string | null; size?: "sm" | "md" }) {
  if (score === null || score === undefined) return null;
  const b = band(score);
  const step = next && next in NEXT_STEPS ? NEXT_STEPS[next as NextStep].label : null;
  return (
    <span className="lsb" data-band={b} data-size={size} title={`${BAND_LABEL[b]} lead, ${score} out of 100${step ? `. Next: ${step}` : ""}`}>
      <span className="lsb-dot" aria-hidden />
      {score}
      <span className="sr-only"> out of 100, {BAND_LABEL[b].toLowerCase()}</span>
    </span>
  );
}
