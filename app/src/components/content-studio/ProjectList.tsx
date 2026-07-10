import Link from "next/link";
import type { VideoProject } from "@/lib/db/schema";

const STATUS_COPY: Record<VideoProject["status"], { label: string; tone: string }> = {
  queued: { label: "Queued", tone: "var(--text-secondary)" },
  transcribing: { label: "Transcribing…", tone: "#2c6ce0" },
  transcribed: { label: "Transcribed", tone: "#15803d" },
  planning: { label: "Planning cuts…", tone: "#7c3aed" },
  rendering: { label: "Rendering…", tone: "#7c3aed" },
  rendered: { label: "Rendered", tone: "#15803d" },
  failed: { label: "Failed", tone: "#dc2626" },
};

function formatDate(d: Date) {
  return new Date(d).toLocaleString("en-IE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function ProjectList({ projects }: { projects: VideoProject[] }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 14,
      }}
    >
      {projects.map((p) => {
        const status = STATUS_COPY[p.status];
        return (
          <Link
            key={p.id}
            href={`/content-studio/videos/${p.id}`}
            style={{
              display: "block",
              background: "var(--bg)",
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius)",
              padding: 18,
              textDecoration: "none",
              color: "inherit",
              boxShadow: "var(--shadow-1)",
              transition: "border-color 0.15s var(--ease)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: status.tone,
                }}
              >
                {status.label}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--text-tertiary)",
                  letterSpacing: "0.04em",
                }}
              >
                {p.aspectRatio} · {p.targetSeconds}s
              </span>
            </div>
            <div
              style={{
                fontFamily: "var(--font-heading), sans-serif",
                fontSize: 20,
                color: "var(--text-primary)",
                marginBottom: 6,
                lineHeight: 1.2,
                textTransform: "uppercase",
              }}
            >
              {p.name}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-tertiary)",
              }}
            >
              {formatDate(p.createdAt)}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
