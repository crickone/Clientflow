/**
 * The Google tag, on a client's public website.
 *
 * Same reason as the Meta Pixel next door: the site we replace usually has
 * one, and losing it on the day the domain moves costs the client their
 * analytics history and any ad conversion tracking hanging off it. Inspire's
 * old site runs both a GA4 tag and a GTM container.
 *
 * ONE field for all three id shapes, because a site has one Google tag:
 *
 *   GTM-…  a Tag Manager container. Everything else — GA4, Ads, whatever
 *          the client adds later — belongs INSIDE it, configured in GTM
 *          rather than pasted onto the page again.
 *   G-…    a GA4 measurement id, for a site with no container.
 *   AW-…   a Google Ads conversion id, same.
 *
 * The two snippets are genuinely different: a container needs the GTM
 * loader plus a noscript iframe, while G-/AW- need gtag.js and a config
 * call. Guessing wrong means the tag silently never fires, so the prefix
 * picks the snippet rather than the operator having to know.
 */

export type GoogleTagKind = "gtm" | "gtag";

/**
 * Which snippet an id needs, or null if it is not a Google tag at all.
 *
 * Strict character classes on purpose: this value is interpolated into a
 * <script> on a live site, so anything that could close the string would
 * take every other script on the page with it.
 */
export function googleTagKind(raw: string): GoogleTagKind | null {
  const id = raw.trim().toUpperCase();
  if (/^GTM-[A-Z0-9]{4,12}$/.test(id)) return "gtm";
  if (/^G-[A-Z0-9]{6,14}$/.test(id)) return "gtag";
  if (/^AW-\d{6,14}$/.test(id)) return "gtag";
  return null;
}

export function isValidGoogleTagId(raw: string): boolean {
  return googleTagKind(raw) !== null;
}

export function GoogleTag({ tagId }: { tagId: string | null | undefined }) {
  const id = (tagId ?? "").trim().toUpperCase();
  const kind = googleTagKind(id);
  if (!kind) return null;

  if (kind === "gtm") {
    return (
      <>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${id}');`,
          }}
        />
        {/* Tag Manager's own fallback for a browser that runs no script. */}
        <noscript>
          <iframe
            src={`https://www.googletagmanager.com/ns.html?id=${id}`}
            height="0"
            width="0"
            style={{ display: "none", visibility: "hidden" }}
            title="Google Tag Manager"
          />
        </noscript>
      </>
    );
  }

  return (
    <>
      <script async src={`https://www.googletagmanager.com/gtag/js?id=${id}`} />
      <script
        dangerouslySetInnerHTML={{
          __html: `window.dataLayer=window.dataLayer||[];
function gtag(){dataLayer.push(arguments);}
gtag('js',new Date());gtag('config','${id}');`,
        }}
      />
    </>
  );
}
