/**
 * Column headings over a section's exercise rows. The row inputs only name
 * themselves in their placeholders, which vanish once a number is typed, so
 * "3 / 8 / 0" read as three unlabelled boxes. Same grid as the rows, inset by
 * the row's 10px padding plus its 1px border so each heading sits over its box.
 */
export function ExerciseColumnHeads() {
  return (
    <div
      aria-hidden
      style={{
        display: "grid",
        gridTemplateColumns: "24px 1fr 70px 90px 90px 30px",
        gap: 8,
        padding: "0 11px",
        marginBottom: -6,
        fontSize: 11.5,
        fontWeight: 500,
        color: "var(--text-tertiary)",
      }}
    >
      <span />
      <span>Exercise</span>
      <span>Sets</span>
      <span>Reps</span>
      <span>Rest (sec)</span>
      <span />
    </div>
  );
}
