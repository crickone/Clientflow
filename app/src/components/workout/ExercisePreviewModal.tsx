"use client";

import { Dumbbell } from "lucide-react";

import { Dialog, DialogContent } from "@/components/ui/Dialog";
import type { ExerciseLibRow } from "@/lib/exerciseLibrary";
import { exerciseHasVideo, parseYouTubeId, youtubeEmbedUrl } from "@/lib/youtube";

/**
 * Shared "preview before you add" modal for the 3 workout builders' exercise
 * pickers (WorkoutBuilder.tsx / CircuitBuilder.tsx's ChooseExerciseSheet,
 * DetailedBuilder.tsx's inline autocomplete dropdown) — a row's ▶ Play button
 * opens this. Purely presentational: no data fetch, no add logic. Closing
 * (Escape / overlay / the built-in X) just calls onClose — the picker
 * underneath is untouched either way.
 */
export function ExercisePreviewModal({
  exercise,
  onClose,
}: {
  exercise: ExerciseLibRow | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={exercise !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={exercise?.name || "Exercise"} width={560}>
        {exercise && <PreviewBody exercise={exercise} />}
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({ exercise }: { exercise: ExerciseLibRow }) {
  const hasVideo = exerciseHasVideo(exercise);
  const videoId = hasVideo ? parseYouTubeId(exercise.videoUrl) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {exercise.muscleGroups.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {exercise.muscleGroups.map((g) => (
            <span key={g} style={chip}>
              {g}
            </span>
          ))}
        </div>
      )}

      {videoId ? (
        <div style={frame}>
          <iframe
            src={youtubeEmbedUrl(videoId)}
            title={exercise.name}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
          />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={fallbackFrame}>
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {exercise.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={exercise.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <Dumbbell size={28} style={{ color: "var(--text-tertiary)" }} />
              )}
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", textAlign: "center" }}>
            No video for this exercise yet.
          </div>
        </div>
      )}
    </div>
  );
}

const chip: React.CSSProperties = {
  fontSize: 10.5,
  padding: "1px 7px",
  borderRadius: 5,
  background: "var(--surface-2)",
  color: "var(--text-tertiary)",
  fontFamily: "var(--font-mono), monospace",
};
const frame: React.CSSProperties = {
  position: "relative",
  width: "100%",
  paddingTop: "56.25%", // 16:9
  borderRadius: "var(--radius)",
  overflow: "hidden",
  border: "1px solid var(--hairline)",
  background: "#000",
};
const fallbackFrame: React.CSSProperties = {
  position: "relative",
  width: "100%",
  paddingTop: "56.25%", // 16:9, so the box doesn't jump size between videoed/un-videoed exercises
  borderRadius: "var(--radius)",
  overflow: "hidden",
  border: "1px solid var(--hairline)",
  background: "var(--surface-2)",
};
