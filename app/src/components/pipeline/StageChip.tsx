/** Colour-coded chip for a lead's current stage. Takes the resolved record (DB stage). */
export function StageChip({ stage }: { stage: { name: string; colour: string } | null }) {
  const colour = stage?.colour ?? "#8b949e";
  const label = stage?.name ?? "—";
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
        color: colour,
        background: `${colour}1f`,
        border: `1px solid ${colour}55`,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: colour,
        }}
      />
      {label}
    </span>
  );
}
