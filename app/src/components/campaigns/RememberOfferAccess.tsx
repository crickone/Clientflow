"use client";

import { useEffect } from "react";

/**
 * The visitor came through the ad link: remember it for 60 days, so the
 * offer is still there when they come back from Stripe, reload, or return
 * later without the link. Strictly necessary for the page to work as the
 * ad promised, so it isn't held behind the tracking consent banner.
 */
export function RememberOfferAccess({ name, value }: { name: string; value: string }) {
  useEffect(() => {
    try {
      document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${60 * 24 * 3600}; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
    } catch {
      /* cookies blocked: the link still works on its own */
    }
  }, [name, value]);
  return null;
}
