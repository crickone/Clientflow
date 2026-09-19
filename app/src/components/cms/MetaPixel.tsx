/**
 * The Meta (Facebook) Pixel, on a client's public website.
 *
 * Why it exists: the site we replace for a client usually has one, and the
 * new one did not. Point the domain at us and their advertising goes blind
 * the same day — no conversion signal for optimisation, no audiences, and
 * the pixel's learning history stops. That is not a conversion problem on
 * the page; it is a launch blocker that only shows up afterwards, as ads
 * quietly getting worse.
 *
 * Per SITE, not per tenant. An agency tenant runs several clients' websites,
 * and one client's ad account must never receive another client's traffic.
 *
 * Rendered ONLY from the public site routes. It must never appear in the
 * admin app: an operator moving around the CRM is not a visitor, and their
 * behaviour would poison the audiences the pixel builds.
 */

/** Meta pixel ids are numeric. Anything else is a paste error, not an id. */
export function isValidPixelId(id: string): boolean {
  return /^\d{8,20}$/.test(id.trim());
}

export function MetaPixel({ pixelId }: { pixelId: string | null | undefined }) {
  const id = (pixelId ?? "").trim();
  // Refuse anything that is not a plausible id rather than interpolating it.
  // This string goes inside a <script>, so a stray quote would not merely
  // fail to track — it would break every script on the page.
  if (!isValidPixelId(id)) return null;

  return (
    <>
      <script
        // Meta's standard snippet. `fbq` queues calls made before the library
        // loads, so PageView fires correctly even on a slow connection.
        dangerouslySetInnerHTML={{
          __html: `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${id}');fbq('track','PageView');`,
        }}
      />
      {/* The no-script fallback Meta's own snippet ships with: it records a
          view from a browser that never runs the library at all. */}
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          alt=""
          src={`https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}
