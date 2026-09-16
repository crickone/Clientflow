"use client";

import { useEffect, useState } from "react";

/**
 * Whether a media query currently matches, kept in sync as the window changes.
 *
 * MOST responsive work does NOT need this — a media query in globals.css is
 * cheaper, has no hydration story, and applies before the first paint. Reach
 * for this only when the DIFFERENCE IS BEHAVIOURAL rather than visual: the
 * photo library animates its WIDTH open on a desktop and its HEIGHT on a
 * phone, and those are different numbers handed to an animation, not two
 * values of one CSS property that a stylesheet could switch between.
 *
 * ALWAYS FALSE ON THE SERVER, and on the first client render. There is no
 * viewport during SSR, so any other default would be a guess, and a guess that
 * disagrees with the browser is a hydration mismatch. The effect then corrects
 * it before paint. Callers must therefore treat `false` as "the wide layout,
 * for now" and not as a fact — which is why the narrow behaviour here is the
 * enhancement and the wide one is the default.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/**
 * The width below which the editor's panels stack instead of sitting beside
 * each other. Matches the `max-width: 760px` blocks in globals.css — the two
 * have to agree, or a panel animates as though it were beside the preview
 * while the stylesheet has already put it underneath.
 */
export const NARROW_QUERY = "(max-width: 760px)";
