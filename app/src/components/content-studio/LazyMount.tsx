"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Only mount a child once it scrolls near view.
 *
 * Every Content Studio thumbnail is a FULL-RESOLUTION canvas render — 1080px
 * square or taller, painted through paintSlide, the same code the export runs.
 * Mounting forty of those at once is what makes a gallery page stall, so each
 * waits for the viewport. The 300px root margin means the render has usually
 * finished before the card is actually looked at.
 *
 * Extracted from ContentStudioHome when the template gallery needed the same
 * behaviour for the same reason.
 */
export function LazyMount({
  children,
  placeholder,
}: {
  children: React.ReactNode;
  placeholder: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || show) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShow(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [show]);
  return (
    <div ref={ref} style={{ width: "100%", height: "100%" }}>
      {show ? children : placeholder}
    </div>
  );
}
