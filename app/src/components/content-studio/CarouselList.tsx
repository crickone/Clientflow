import Link from "next/link";
import type { CarouselSummary } from "@/lib/image/carousels";
import { getTemplate } from "@/lib/image/templates";

function formatDate(d: Date) {
  return new Date(d).toLocaleString("en-IE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function CarouselList({ carousels }: { carousels: CarouselSummary[] }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 14,
      }}
    >
      {carousels.map((c) => {
        const tpl = c.firstSlide ? getTemplate(c.firstSlide.templateId) : null;
        return (
          <Link
            key={c.id}
            href={`/content-studio/images/${c.id}`}
            style={{
              display: "block",
              background: "var(--bg)",
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius)",
              padding: 18,
              textDecoration: "none",
              color: "inherit",
              boxShadow: "var(--shadow-1)",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 14,
                alignItems: "flex-start",
              }}
            >
              <div
                style={{
                  width: 72,
                  height: 72,
                  background: c.firstSlide?.accentColor ?? "#2c6ce0",
                  borderRadius: "var(--radius)",
                  flexShrink: 0,
                  border: "1px solid var(--hairline)",
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background:
                      "linear-gradient(180deg, rgba(0,0,0,0) 50%, rgba(0,0,0,0.45) 100%)",
                  }}
                />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--text-tertiary)",
                    marginBottom: 6,
                  }}
                >
                  {c.slideCount} SLIDE{c.slideCount === 1 ? "" : "S"}
                  {tpl ? ` · ${tpl.aspectRatio}` : ""}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-heading), sans-serif",
                    fontSize: 18,
                    color: "var(--text-primary)",
                    lineHeight: 1.2,
                    textTransform: "uppercase",
                    marginBottom: 8,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {c.name}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-tertiary)",
                  }}
                >
                  Updated {formatDate(c.updatedAt)}
                </div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
