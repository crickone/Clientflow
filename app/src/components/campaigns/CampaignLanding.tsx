import { themeCss, type ThemeConfig } from "@/lib/theme";
import { getFontOption, DEFAULT_HEADING_FONT_ID, DEFAULT_BODY_FONT_ID } from "@/lib/image/fonts";
import type { ParsedLandingBody } from "@/lib/campaigns/assetBody";
import type { BusinessProfile } from "@/lib/businessProfile";
import { Check } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { SignupForm } from "./SignupForm";

interface Props {
  body: ParsedLandingBody;
  theme: ThemeConfig;
  /** Content-Studio font ids (getBrandFontIds()'s shape) — resolved to real
   *  CSS font-family strings below via getFontOption. */
  fonts: { heading: string; body: string };
  /** Base64 data URI, or null when the tenant hasn't uploaded a logo — see
   *  the route's logoDataUri() for why this is inlined bytes rather than a
   *  /api/branding/logo URL. */
  logoSrc: string | null;
  business: BusinessProfile;
  /** Server-signed (tenantId, campaignId) claim — the ONLY identity handed
   *  to <SignupForm>. No siteSlug/campaignSlug prop exists on this
   *  component, deliberately — see lib/campaigns/signupToken.ts. */
  signupToken: string;
}

/** Resolve a Content-Studio font id to a CSS font-family string usable in an
 *  inline style, e.g. "var(--font-heading), \"Hanken Grotesk\", sans-serif".
 *  The var() half is what makes it render the tenant's actual chosen face —
 *  app/fonts.ts registers every FONT_OPTIONS cssVar on <html> regardless of
 *  route (see app/layout.tsx's FONT_VARS, applied on every branch including
 *  /site/*), so these variables are always available here even though this
 *  page never goes through the authenticated app shell. Falls back to the
 *  Content Studio default id, then to a generic stack, so an unset/unknown
 *  id can never leave text unstyled. */
function resolveFontFamily(id: string, fallbackId: string): string {
  const option = getFontOption(id) ?? getFontOption(fallbackId);
  if (!option) return "system-ui, sans-serif";
  return `var(${option.cssVar}), ${option.fallback}`;
}

/**
 * The public, branded campaign landing page (Campaign Engine Slice 2, Task
 * 3). Server component — renders an APPROVED landing_page asset's body,
 * themed from the tenant's own settings/theme/fonts/logo/business profile
 * (all resolved by the route, INSIDE runWithTenant, and passed down as
 * plain props — this component touches no DB/tenant-context itself).
 *
 * The tenant's theme isn't ambient here the way it is in the authenticated
 * app shell — /site/* routes render OUTSIDE the root layout's admin
 * <style id="tenant-theme"> injection (see app/layout.tsx: it only injects
 * that for the admin shell and the signed-in client app, never for
 * pathname.startsWith("/site/")) — so this component injects its OWN
 * `:root{}` override via themeCss(theme), scoped to nothing more than "this
 * HTML document", same technique app/layout.tsx uses for the client app.
 * Everything below then reads the SAME --accent / --bg / --surface-N /
 * --text-N custom properties the rest of the app uses, rather than
 * hand-rolling a parallel colour system.
 *
 * Self-contained + mobile-responsive via clamp() fluid type/spacing and a
 * CSS grid with auto-fit/minmax (collapses to a single column under ~640px
 * with no explicit breakpoint needed) — no external stylesheet, no JS
 * required to render correctly at any width.
 */
export function CampaignLanding({ body, theme, fonts, logoSrc, business, signupToken }: Props) {
  const headingFamily = resolveFontFamily(fonts.heading, DEFAULT_HEADING_FONT_ID);
  const bodyFamily = resolveFontFamily(fonts.body, DEFAULT_BODY_FONT_ID);

  // Every field on a parsed landing body is independently optional (see
  // assetBody.ts's parseLandingBody doc — a model can get most fields right
  // and drop one), so each is defended here individually rather than relying
  // on a single whole-object fallback further up.
  const businessName = business.businessName.trim() || "Us";
  const headline = body.headline.trim() || businessName;
  const subhead = body.subhead.trim();
  const bullets = body.bullets.map((b) => b.trim()).filter((b) => b.length > 0);
  // body.ctaLabel is intentionally NOT read here — the CTA is a business
  // invariant, hardcoded inside <SignupForm> itself rather than threaded
  // through as a prop. See that component's CTA_LABEL comment for why.
  const phone = business.phone.trim();
  const telHref = phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : null;

  return (
    <>
      <style id="campaign-landing-theme" dangerouslySetInnerHTML={{ __html: themeCss(theme) }} />
      <main
        style={{
          minHeight: "100vh",
          background: "var(--bg)",
          color: "var(--text-primary)",
          fontFamily: bodyFamily,
        }}
      >
        <header
          style={{
            padding: "18px clamp(20px, 6vw, 64px)",
            borderBottom: "1px solid var(--hairline)",
          }}
        >
          <Logo src={logoSrc} alt={businessName} height={28} />
        </header>

        <section style={{ background: "var(--accent)", padding: "clamp(48px, 9vw, 96px) clamp(20px, 6vw, 64px)" }}>
          <div style={{ maxWidth: 760, margin: "0 auto" }}>
            <h1
              style={{
                margin: 0,
                fontFamily: headingFamily,
                fontSize: "clamp(32px, 5.5vw, 58px)",
                lineHeight: 1.1,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                color: "var(--accent-contrast)",
                overflowWrap: "anywhere",
              }}
            >
              {headline}
            </h1>
            {subhead && (
              <p
                style={{
                  margin: "18px 0 0",
                  fontSize: "clamp(15px, 2.2vw, 19px)",
                  lineHeight: 1.55,
                  color: "rgba(26,10,3,0.72)",
                  maxWidth: 560,
                  overflowWrap: "anywhere",
                }}
              >
                {subhead}
              </p>
            )}
          </div>
        </section>

        <section style={{ padding: "clamp(32px, 6vw, 64px) clamp(20px, 6vw, 64px) clamp(56px, 8vw, 88px)" }}>
          <div
            style={{
              maxWidth: 1040,
              margin: "0 auto",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: "clamp(28px, 5vw, 56px)",
              alignItems: "start",
            }}
          >
            <div>
              {bullets.length > 0 ? (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 14 }}>
                  {bullets.map((bullet, i) => (
                    <li
                      key={i}
                      style={{
                        display: "flex",
                        gap: 12,
                        alignItems: "flex-start",
                        fontSize: 15.5,
                        lineHeight: 1.5,
                        overflowWrap: "anywhere",
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          flexShrink: 0,
                          width: 22,
                          height: 22,
                          marginTop: 1,
                          borderRadius: "50%",
                          background: "var(--accent-soft)",
                          color: "var(--accent)",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 12.5,
                          fontWeight: 700,
                        }}
                      >
                        <Check size={14} />
                      </span>
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>
                  Fill in your details and {businessName} will be in touch shortly.
                </p>
              )}
            </div>

            <div
              style={{
                background: "var(--surface-1)",
                border: "1px solid var(--hairline)",
                borderRadius: 16,
                padding: "clamp(20px, 4vw, 32px)",
              }}
            >
              <SignupForm token={signupToken} />
              {telHref && (
                <p style={{ margin: "16px 0 0", fontSize: 13, color: "var(--text-tertiary)", textAlign: "center" }}>
                  Prefer to talk? Call{" "}
                  <a href={telHref} style={{ color: "var(--accent-ink)" }}>
                    {phone}
                  </a>
                </p>
              )}
            </div>
          </div>
        </section>

        <footer style={{ borderTop: "1px solid var(--hairline)", padding: "22px clamp(20px, 6vw, 64px)", textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-tertiary)" }}>
            {businessName}
            {telHref && (
              <>
                {" "}
                ·{" "}
                <a href={telHref} style={{ color: "inherit" }}>
                  {phone}
                </a>
              </>
            )}
          </p>
        </footer>
      </main>
    </>
  );
}
