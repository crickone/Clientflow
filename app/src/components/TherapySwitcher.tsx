"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { IndexEntry, TherapyId } from "@/lib/therapies";

interface Props {
  therapies: IndexEntry[];
  active: TherapyId;
}

export function TherapySwitcher({ therapies, active }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());
  const [indicator, setIndicator] = useState<{ x: number; w: number } | null>(
    null,
  );

  const measure = () => {
    const container = containerRef.current;
    const el = itemRefs.current.get(active);
    if (!container || !el) return;
    const cRect = container.getBoundingClientRect();
    const iRect = el.getBoundingClientRect();
    setIndicator({ x: iRect.left - cRect.left, w: iRect.width });
  };

  useLayoutEffect(measure, [active]);
  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [active]);

  return (
    <div
      style={{
        background: "rgba(255, 255, 255, 0.72)",
        borderBottom: "1px solid var(--hairline)",
        position: "sticky",
        top: 0,
        zIndex: 20,
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
      }}
    >
      <div
        style={{
          maxWidth: "var(--max-width)",
          margin: "0 auto",
          padding: "16px 32px",
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <span
          style={{
            color: "var(--text-tertiary)",
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          Therapy
        </span>
        <div
          ref={containerRef}
          role="tablist"
          style={{
            position: "relative",
            display: "inline-flex",
            background: "var(--surface-2)",
            border: "1px solid var(--hairline)",
            borderRadius: "var(--radius)",
            padding: 4,
          }}
        >
          {/* Sliding indicator */}
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 4,
              left: 0,
              height: "calc(100% - 8px)",
              width: indicator ? indicator.w : 0,
              transform: `translateX(${indicator ? indicator.x : 0}px)`,
              background: "var(--bg)",
              borderRadius: "var(--radius)",
              boxShadow:
                "0 1px 0 rgba(0,0,0,0.04) inset, 0 4px 14px -6px rgba(0,0,0,0.16)",
              transition:
                "transform 0.42s var(--ease), width 0.42s var(--ease), opacity 0.2s",
              opacity: indicator ? 1 : 0,
              pointerEvents: "none",
            }}
          />
          {therapies.map((t) => {
            const isActive = t.id === active;
            return (
              <Link
                key={t.id}
                href={`/marketing/${t.id}`}
                role="tab"
                aria-selected={isActive}
                prefetch={false}
                ref={(el) => {
                  if (el) itemRefs.current.set(t.id, el);
                  else itemRefs.current.delete(t.id);
                }}
                style={{
                  position: "relative",
                  zIndex: 1,
                  padding: "9px 20px",
                  borderRadius: "var(--radius)",
                  fontSize: 13,
                  fontWeight: 500,
                  letterSpacing: "-0.005em",
                  color: isActive
                    ? "var(--text-primary)"
                    : "var(--text-secondary)",
                  transition: "color 0.32s var(--ease)",
                }}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
