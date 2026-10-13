"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

/**
 * Tell the Meta pixel about a purchase, once. The pixel only loads after the
 * visitor accepts cookies (SiteTracking), so this waits for it and gives up
 * after 15 seconds; eventID lets Meta drop a duplicate if the page reloads.
 */
export function PurchaseEvent({ eventId, valueCents, currency }: { eventId: string; valueCents: number; currency: string }) {
  useEffect(() => {
    const key = `purchase-sent:${eventId}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
    } catch {
      /* storage blocked: fall through, eventID still dedupes */
    }
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (typeof window.fbq === "function") {
        window.fbq("track", "Purchase", { value: valueCents / 100, currency: currency.toUpperCase() }, { eventID: eventId });
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
  }, [eventId, valueCents, currency]);
  return null;
}
