"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

/**
 * Fire one Meta Pixel event, once per event id. The Pixel only loads after
 * the visitor accepts cookies (SiteTracking), so this waits for it and gives
 * up after 15 seconds. The server sends the same event with the same id
 * (lib/facebook/capi.ts), so Meta keeps one of the two.
 */
export function PixelEvent({ name, eventId, params }: { name: string; eventId: string; params?: Record<string, unknown> }) {
  useEffect(() => {
    const key = `pixel-sent:${eventId}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
    } catch {
      /* storage blocked: fall through, eventID still dedupes */
    }
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (typeof window.fbq === "function") {
        window.fbq("track", name, params ?? {}, { eventID: eventId });
        try {
          window.sessionStorage.setItem(key, "1");
        } catch {
          /* ignore */
        }
        clearInterval(t);
      } else if (tries > 30) {
        clearInterval(t);
      }
    }, 500);
    return () => clearInterval(t);
    // The params are fixed for an event id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, eventId]);
  return null;
}
