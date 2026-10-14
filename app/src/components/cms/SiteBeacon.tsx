"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { attachArrivalToEnquiryForms, rememberArrival } from "./arrivalClient";

/**
 * Anonymous first-party page-view beacon. No cookie, no identifiers: it sends
 * the path, the referrer and a utm_source, and the server aggregates per day.
 * Not consent-gated because it stores nothing about the visitor (see
 * /api/site-events). It also notes how the visit began (arrivalClient) —
 * kept on the device only after the cookie banner is accepted — so an
 * enquiry or purchase can say where the person came from. Rendered only on public pages,
 * never in Studio edit mode or draft previews.
 */
export function SiteBeacon() {
  const pathname = usePathname();
  useEffect(() => {
    // How this visit began, for the lead if they get in touch (arrivalClient).
    rememberArrival();
    attachArrivalToEnquiryForms();
    try {
      const u = new URLSearchParams(window.location.search).get("utm_source") ?? "";
      const body = JSON.stringify({ p: window.location.pathname, r: document.referrer || "", u });
      if (navigator.sendBeacon) navigator.sendBeacon("/api/site-events", new Blob([body], { type: "application/json" }));
      else void fetch("/api/site-events", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } });
    } catch {
      // analytics must never break the page
    }
  }, [pathname]);
  return null;
}
