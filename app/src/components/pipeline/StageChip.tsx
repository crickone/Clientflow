import { STAGES, type PipelineStage } from "@/lib/pipeline/stages";

/** Colour-coded chip for a lead's current pipeline stage. */
export function StageChip({ stage }: { stage: PipelineStage }) {
  const s = STAGES[stage] ?? STAGES.new_lead;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 9px",
        borderRadius: "var(--radius)",
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: "nowrap",
        color: s.colourHex,
        background: `${s.colourHex}1f`,
        border: `1px solid ${s.colourHex}55`,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: s.colourHex,
        }}
      />
      {s.label}
    </span>
  );
}
