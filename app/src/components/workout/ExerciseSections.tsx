import { Dumbbell } from "lucide-react";

import { dayVolume, fmtRest, SECTIONS, type ExerciseInput } from "@/lib/workoutModel";
import { normalizeExerciseName } from "@/lib/workoutPreviewMedia";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Shared, read-only render of one day/workout's exercises — grouped by
 * section (warm up / workout / cool down) with a total-volume-sets summary
 * and optional instructions underneath. Extracted from the admin's
 * WorkoutPreview (originally inline there) so the client-facing workout
 * program detail view can render each program day identically without
 * duplicating the markup. Pure presentational: no hooks, no data fetching, no
 * admin-only concerns (edit/delete stay in the callers) — safe to render from
 * either the staff admin or the client-facing app.
 */
export function ExerciseSections({
  exercises,
  instructions,
  media,
}: {
  exercises: ExerciseInput[];
  instructions?: string | null;
  media: Record<string, string | null>;
}) {
  const volume = dayVolume({ exercises });

  return (
    <>
      {volume.length > 0 && (
        <div>
          <div style={sectionLabel}>Total volume sets</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {volume.map((v) => (
              <span key={v.group} style={{ fontSize: 12.5, padding: "4px 11px", borderRadius: 999, background: "rgba(34,197,94,0.12)", color: "#22c55e" }}>
                {v.group} {v.sets}
              </span>
            ))}
          </div>
        </div>
      )}

      {SECTIONS.map((sec) => {
        const rows = exercises.filter((e) => e.section === sec.key);
        if (rows.length === 0) return null;
        return (
          <div key={sec.key}>
            <div style={sectionLabel}>{sec.label}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
              {rows.map((ex, i) => {
                const url = media[normalizeExerciseName(ex.name)] ?? null;
                return (
                  <div key={i} style={exRow}>
                    <span style={{ fontFamily: "var(--font-mono), monospace", fontWeight: 700, color: "var(--text-tertiary)", width: 18, textAlign: "center" }}>{LETTERS[i] ?? "•"}</span>
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                    ) : (
                      <span style={{ width: 44, height: 44, borderRadius: 8, background: "var(--surface-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--text-tertiary)", flexShrink: 0 }}>
                        <Dumbbell size={20} />
                      </span>
                    )}
                    <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{ex.name}</span>
                    <span style={stat}>Sets: {ex.sets}</span>
                    {ex.reps && <span style={stat}>Reps: {ex.reps}</span>}
                    {ex.restSeconds > 0 && <span style={stat}>REST: {fmtRest(ex.restSeconds)}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {instructions && (
        <div>
          <div style={sectionLabel}>Instructions</div>
          <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{instructions}</p>
        </div>
      )}
    </>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  color: "var(--text-primary)",
};
const exRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "12px 16px",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
};
const stat: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-secondary)",
  minWidth: 90,
};
