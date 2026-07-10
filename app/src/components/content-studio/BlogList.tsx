import Link from "next/link";
import type { BlogPost } from "@/lib/db/schema";
import { getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";

const STATUS_COPY: Record<BlogPost["status"], { label: string; tone: string }> = {
  generating: { label: "Generating…", tone: "#2c6ce0" },
  ready: { label: "Ready", tone: "#15803d" },
  failed: { label: "Failed", tone: "#dc2626" },
};

function modeCopy(mode: BlogPost["inputMode"], serviceTerm: string): string {
  if (mode === "therapy") return `${serviceTerm} focus`;
  return mode === "video" ? "From video" : "Topic prompt";
}

function formatDate(d: Date) {
  return new Date(d).toLocaleString("en-IE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function BlogList({ posts }: { posts: BlogPost[] }) {
  const vocab = getVocab(getVenueType());
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
        gap: 14,
      }}
    >
      {posts.map((p) => {
        const status = STATUS_COPY[p.status];
        return (
          <Link
            key={p.id}
            href={`/content-studio/blogs/${p.id}`}
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
                {modeCopy(p.inputMode, vocab.service)} · {p.targetWords}w
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
              {p.title}
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
