"use client";

import { useCallback, useEffect, useState } from "react";

import {
  consentStorageKey,
  googleTagKind,
  isValidGoogleTagId,
  isValidPixelId,
  mayTrack,
  parseConsent,
  type ConsentChoice,
} from "@/lib/cms/trackingIds";

/**
 * Analytics and advertising tags on a client's website, behind consent.
 *
 * The tags shipped first and fired on page load, which is how almost every
 * small site does it and is not lawful here: these clients are Irish
 * businesses serving EU visitors, and under GDPR and the ePrivacy rules
 * analytics and advertising cookies need consent BEFORE they load. Webflow
 * surfaces the same thing as a "delay for cookie consent" switch next to its
 * pixel field.
 *
 * There is deliberately NO switch to turn this off. A toggle here is a
 * toggle for breaking the law on a client's behalf, and the one time
 * somebody flips it for a good reason is the time nobody flips it back.
 *
 * Consequences of gating, both intended:
 *
 *  - the scripts are injected from here at runtime rather than server
 *    rendered, because a <script> in the HTML has already run by the time
 *    anyone could consent;
 *  - the noscript fallbacks are GONE. A tracking pixel in a <noscript> fires
 *    without JavaScript and therefore without any possibility of consent,
 *    which is exactly what this exists to prevent.
 */
export function SiteTracking({
  siteSlug,
  pixelId,
  googleTagId,
}: {
  siteSlug: string;
  pixelId: string | null | undefined;
  googleTagId: string | null | undefined;
}) {
  const pixel = (pixelId ?? "").trim();
  const google = (googleTagId ?? "").trim().toUpperCase();
  const hasTags = isValidPixelId(pixel) || isValidGoogleTagId(google);

  // `undefined` = not read yet. Rendering the banner before the stored
  // choice is known would flash it at everyone on every page.
  const [choice, setChoice] = useState<ConsentChoice | null | undefined>(undefined);

  const read = useCallback((): ConsentChoice | null => {
    try {
      return parseConsent(window.localStorage.getItem(consentStorageKey(siteSlug)));
    } catch {
      // Private windows and blocked storage throw. No decision, so nothing
      // fires and the visitor is asked again.
      return null;
    }
  }, [siteSlug]);

  useEffect(() => {
    setChoice(read());
    // A link to #cookie-settings reopens the choice, which is how someone
    // withdraws consent later — the privacy policy can point at it.
    const onHash = () => {
      if (window.location.hash === "#cookie-settings") setChoice(null);
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [read]);

  // Load the tags, once, and only on an explicit yes.
  useEffect(() => {
    if (!mayTrack(choice ?? null) || !hasTags) return;
    if ((window as { __cmsTagsLoaded?: boolean }).__cmsTagsLoaded) return;
    (window as { __cmsTagsLoaded?: boolean }).__cmsTagsLoaded = true;

    if (isValidPixelId(pixel)) {
      const s = document.createElement("script");
      s.text = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixel}');fbq('track','PageView');`;
      document.head.appendChild(s);
    }

    const kind = googleTagKind(google);
    if (kind === "gtm") {
      const s = document.createElement("script");
      s.text = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${google}');`;
      document.head.appendChild(s);
    } else if (kind === "gtag") {
      const lib = document.createElement("script");
      lib.async = true;
      lib.src = `https://www.googletagmanager.com/gtag/js?id=${google}`;
      document.head.appendChild(lib);
      const cfg = document.createElement("script");
      cfg.text = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${google}');`;
      document.head.appendChild(cfg);
    }
  }, [choice, hasTags, pixel, google]);

  function decide(next: ConsentChoice) {
    try {
      window.localStorage.setItem(consentStorageKey(siteSlug), next);
    } catch {
      // Remembering failed, so they will be asked again. Honouring the
      // answer for this page view still matters more than the record of it.
    }
    if (window.location.hash === "#cookie-settings") {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    setChoice(next);
  }

  // Nothing to ask about if no tag is configured, and nothing to show once
  // the visitor has answered.
  if (!hasTags || choice === undefined || choice !== null) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookies"
      style={{
        position: "fixed",
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 9999,
        maxWidth: 680,
        margin: "0 auto",
        padding: "16px 18px",
        borderRadius: 12,
        // Inherits the site's own palette: this sits on the client's page,
        // not ours, and a stranger's colour scheme on their site reads as a
        // third-party advert rather than their own notice.
        background: "var(--surface, #111)",
        color: "var(--ink, #f4f4f5)",
        border: "1px solid currentColor",
        boxShadow: "0 20px 60px rgba(0,0,0,.45)",
        display: "flex",
        gap: 14,
        alignItems: "center",
        flexWrap: "wrap",
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      <p style={{ margin: 0, flex: "1 1 320px", minWidth: 0 }}>
        We use cookies to measure how this site is used and to improve our advertising. Nothing is
        loaded unless you agree.
      </p>
      <div style={{ display: "flex", gap: 10, flex: "0 0 auto" }}>
        <button
          type="button"
          onClick={() => decide("denied")}
          style={{
            padding: "9px 16px",
            borderRadius: 6,
            border: "1px solid currentColor",
            background: "transparent",
            color: "inherit",
            font: "inherit",
            cursor: "pointer",
          }}
        >
          Decline
        </button>
        <button
          type="button"
          onClick={() => decide("granted")}
          style={{
            padding: "9px 16px",
            borderRadius: 6,
            border: "1px solid currentColor",
            background: "currentColor",
            font: "inherit",
            cursor: "pointer",
          }}
        >
          {/* The label takes the panel's background so it reads on the fill,
              whatever palette the site uses. */}
          <span style={{ color: "var(--surface, #111)" }}>Accept</span>
        </button>
      </div>
    </div>
  );
}
