"use client";

import { arrivalFromPage, type Arrival } from "@/lib/arrival";

const KEY = "aa_arrival";

/** The visitor accepted the site's cookie banner (SiteTracking; one site per origin). */
function consented(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("cms-consent:") && localStorage.getItem(k) === "granted") return true;
    }
  } catch {
    // storage blocked
  }
  return false;
}

/**
 * Note how this visit began, once per visit (sessionStorage: gone when the
 * tab closes) — and only for a visitor who accepted the cookie banner, since
 * it's kept on their device. Only ever sent anywhere when the person sends a
 * form or starts a checkout (lib/arrival.ts). SiteTracking calls this again
 * the moment they click Accept, while the landing page's address is still
 * the one they arrived on.
 */
export function rememberArrival(): void {
  try {
    if (!consented() || sessionStorage.getItem(KEY)) return;
    const a = arrivalFromPage(window.location.href, document.referrer || "", Date.now());
    sessionStorage.setItem(KEY, JSON.stringify(a ?? { landing: window.location.pathname, at: Date.now() }));
  } catch {
    // storage blocked: the journey just won't say how they arrived
  }
}

/**
 * How this visit began: the remembered arrival when there is one, otherwise
 * what the current page shows (its ad tags and referrer) — which covers an ad
 * that lands straight on the page where they sign up or buy, with nothing
 * stored.
 */
export function readArrival(): Arrival | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Arrival;
  } catch {
    // fall through to the current page
  }
  try {
    return arrivalFromPage(window.location.href, document.referrer || "", Date.now());
  } catch {
    return null;
  }
}

let listening = false;

/**
 * The website's own enquiry forms post straight to /api/site/enquiry from the
 * client's bespoke page markup. Add the arrival as a hidden field as each one
 * is sent (capture phase, so it's there before the page's own handler builds
 * its request).
 */
export function attachArrivalToEnquiryForms(): void {
  if (listening) return;
  listening = true;
  document.addEventListener(
    "submit",
    (e) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (!(form.getAttribute("action") ?? "").includes("/api/site/enquiry")) return;
      const a = readArrival();
      if (!a) return;
      let input = form.querySelector<HTMLInputElement>('input[name="arrival"]');
      if (!input) {
        input = document.createElement("input");
        input.type = "hidden";
        input.name = "arrival";
        form.appendChild(input);
      }
      input.value = JSON.stringify(a);
    },
    true,
  );
}
