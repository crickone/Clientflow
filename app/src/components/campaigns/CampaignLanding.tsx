import { Phone, Plus } from "lucide-react";

import { themeCss, type ThemeConfig } from "@/lib/theme";
import type { ParsedLandingBody } from "@/lib/campaigns/assetBody";
import type { BusinessProfile } from "@/lib/businessProfile";
import { SignupForm } from "./SignupForm";
import { type LandingOffer } from "./OfferBuyBox";
import { LandingOfferMenu } from "./LandingOfferMenu";
import { PurchaseEvent } from "./PurchaseEvent";
import { LANDING_CSS } from "./landingCss";

interface Props {
  body: ParsedLandingBody;
  business: BusinessProfile;
  /** Base64 data URI of the tenant's logo, or null (the route's logoDataUri). */
  logoSrc: string | null;
  /**
   * The client's own website design (getSiteChrome().head: their stylesheet
   * and fonts), so this page looks like part of their site. Empty when the
   * tenant has no published site pages; `theme` is used instead.
   */
  siteHead: string;
  theme: ThemeConfig;
  /** Photographs from the client's own website, best match first (getSitePhotos). */
  photos: string[];
  /** The campaign's run, ISO dates, for the line above the headline. */
  dates: { startsOn: string | null; endsOn: string | null };
  /** Server-signed (tenantId, campaignId) claim for the enquiry form (lib/campaigns/signupToken). */
  signupToken: string;
  /** What's for sale on this page (Stripe Checkout). Empty for visitors without the ad link. */
  offers?: LandingOffer[];
  /** The buyer back from Stripe: paid, or still being confirmed. */
  purchase?: { status: "paid" | "processing"; email: string | null; title: string; orderId: number; amountCents: number; currency: string } | null;
}

// Reads the site's own page background and text colour once the site's
// stylesheet has applied, so buttons and panels are drawn in them (see
// landingCss.ts). Runs as the page is parsed, before the content paints.
const SITE_COLOURS = `(function(){try{var r=document.currentScript.parentElement;function c(e,p){var v=getComputedStyle(e)[p];return v&&v!=="rgba(0, 0, 0, 0)"&&v!=="transparent"?v:null}var b=document.body,h=document.documentElement;var paper=c(b,"backgroundColor")||c(h,"backgroundColor");var ink=c(b,"color");if(paper)r.style.setProperty("--cl-paper",paper);if(ink)r.style.setProperty("--cl-ink",ink)}catch(e){}})();`;

function dayMonth(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "long", timeZone: "UTC" });
}

function runLine(dates: Props["dates"]): string | null {
  if (dates.startsOn && dates.endsOn) return `${dayMonth(dates.startsOn)} to ${dayMonth(dates.endsOn)}`;
  if (dates.endsOn) return `Until ${dayMonth(dates.endsOn)}`;
  return null;
}

/**
 * The public campaign landing page: a short sales page on the client's own
 * domain, in their website's design and photographs. Its jobs, in order:
 * show the offer with its prices and Buy buttons (visitors who came through
 * the ad), take an enquiry (everyone), and say plainly what happens after
 * buying. No site navigation, deliberately: every menu link is an exit
 * (decided with the operator 2026-09-19; see the route's header).
 */
export function CampaignLanding({ body, business, logoSrc, siteHead, theme, photos, dates, signupToken, offers = [], purchase }: Props) {
  const businessName = business.businessName.trim() || "Us";
  const headline = body.headline.trim() || businessName;
  const subhead = body.subhead.trim();
  const bullets = body.bullets.map((b) => b.trim()).filter(Boolean);
  const benefits = body.benefits.slice(0, 3);
  const faqs = body.faqs.slice(0, 5);
  const phone = business.phone.trim();
  const telHref = phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : null;
  const email = business.email.trim();
  const location = business.location.trim();
  const selling = offers.length > 0;
  const run = runLine(dates);
  const [hero, ...more] = photos;
  const strip = more.slice(0, 3);
  const useBy = selling && offers.every((o) => o.useByDate === offers[0].useByDate) ? dayMonth(offers[0].useByDate) : null;
  const cta = selling ? { href: "#offer", label: body.ctaLabel.trim() || "See prices" } : { href: "#ask", label: "Get in touch" };
  const contact = [telHref && phone ? `call ${phone}` : "", email ? `email ${email}` : ""].filter(Boolean).join(" or ");

  return (
    <>
      {siteHead ? (
        <div dangerouslySetInnerHTML={{ __html: siteHead }} />
      ) : (
        <style id="campaign-landing-theme" dangerouslySetInnerHTML={{ __html: themeCss(theme) }} />
      )}
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />
      <div className="cl" suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: SITE_COLOURS }} />
        <div className="cl-wrap">
          <header className="cl-bar">
            {logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoSrc} alt={businessName} />
            ) : (
              <span className="cl-bar-name">{businessName}</span>
            )}
            <div className="cl-bar-right">
              {telHref && (
                <a className="cl-tel" href={telHref}>
                  {phone}
                </a>
              )}
              <a className="cl-btn cl-btn--sm" href={cta.href}>
                {cta.label}
              </a>
            </div>
          </header>

          <section className={`cl-hero${hero ? "" : " cl-hero--nophoto"}`}>
            <div>
              {run && <p className="cl-eyebrow">{run}</p>}
              <h1>{headline}</h1>
              {subhead && <p className="cl-hero-sub">{subhead}</p>}
              {purchase ? (
                <div className="cl-thanks" role="status">
                  <h2>{purchase.status === "paid" ? "Thank you" : "Payment received"}</h2>
                  <p>
                    {purchase.status === "paid"
                      ? `Your ${purchase.title} is confirmed.${purchase.email ? ` We've emailed the details to ${purchase.email}.` : ""}${contact ? ` To book your time, ${contact}.` : ""}`
                      : "We're confirming your payment with the bank. Your confirmation email will follow shortly."}
                  </p>
                  {purchase.status === "paid" && (
                    <PurchaseEvent eventId={`offer-order-${purchase.orderId}`} valueCents={purchase.amountCents} currency={purchase.currency} />
                  )}
                </div>
              ) : (
                <div className="cl-hero-cta">
                  <a className="cl-btn" href={cta.href}>
                    {cta.label}
                  </a>
                  {telHref && (
                    <a className="cl-btn cl-btn--ghost" href={telHref}>
                      <Phone size={15} aria-hidden /> Call us
                    </a>
                  )}
                </div>
              )}
            </div>
            {hero && (
              <div className="cl-hero-photo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={hero} alt="" fetchPriority="high" />
              </div>
            )}
          </section>

          {selling && (
            <section className="cl-section" id="offer" aria-labelledby="cl-offer-h">
              <div className="cl-section-head">
                <p className="cl-eyebrow">{offers.length > 1 ? "Choose yours" : "The offer"}</p>
                <h2 id="cl-offer-h">{offers.length > 1 ? "Prices" : offers[0].title}</h2>
              </div>
              <LandingOfferMenu offers={offers} />
            </section>
          )}

          {benefits.length > 0 && (
            <section className="cl-section" aria-labelledby="cl-why-h">
              <div className="cl-section-head">
                <p className="cl-eyebrow">Why {businessName}</p>
                <h2 id="cl-why-h">What you get</h2>
              </div>
              <ul className="cl-steps cl-why">
                {benefits.map((b) => (
                  <li key={b.title}>
                    <h3>{b.title}</h3>
                    <p>{b.text}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {strip.length >= 2 && (
            <div className={`cl-strip${strip.length === 2 ? " cl-strip--2" : ""}`} aria-hidden>
              {strip.map((src) => (
                <figure key={src}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" loading="lazy" />
                </figure>
              ))}
            </div>
          )}

          {bullets.length > 0 && (
            <section className="cl-section" aria-labelledby="cl-know-h">
              <div className="cl-section-head">
                <p className="cl-eyebrow">{businessName}</p>
                <h2 id="cl-know-h">Good to know</h2>
              </div>
              <ul className="cl-list">
                {bullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </section>
          )}

          {selling && (
            <section className="cl-section" aria-labelledby="cl-how-h">
              <div className="cl-section-head">
                <p className="cl-eyebrow">After you buy</p>
                <h2 id="cl-how-h">How it works</h2>
              </div>
              <ol className="cl-steps">
                <li>
                  <span className="cl-step-n">Step 1</span>
                  <h3>Pay online</h3>
                  <p>Choose above and pay securely by card, Apple Pay or Google Pay.</p>
                </li>
                <li>
                  <span className="cl-step-n">Step 2</span>
                  <h3>Check your email</h3>
                  <p>Your confirmation arrives straight away with what you bought{useBy ? ` and the date to use it by, ${useBy}` : ""}.</p>
                </li>
                <li>
                  <span className="cl-step-n">Step 3</span>
                  <h3>Book your time</h3>
                  <p>{contact ? `To book, ${contact}.` : "Get in touch to book a time that suits you."}</p>
                </li>
              </ol>
            </section>
          )}

          {faqs.length > 0 && (
            <section className="cl-section" aria-labelledby="cl-faq-h">
              <div className="cl-section-head">
                <p className="cl-eyebrow">Questions</p>
                <h2 id="cl-faq-h">{selling ? "Before you buy" : "Good questions"}</h2>
              </div>
              <div className="cl-faqs">
                {faqs.map((f) => (
                  <details key={f.q} className="cl-faq">
                    <summary>
                      <span>{f.q}</span>
                      <Plus size={18} aria-hidden className="cl-faq-icon" />
                    </summary>
                    <p>{f.a}</p>
                  </details>
                ))}
              </div>
            </section>
          )}

          <section className="cl-section" id="ask" aria-labelledby="cl-ask-h">
            <div className="cl-ask">
              <div>
                <div className="cl-section-head" style={{ marginBottom: 0 }}>
                  <p className="cl-eyebrow">{selling ? "Questions first?" : "Get in touch"}</p>
                  <h2 id="cl-ask-h">{selling ? "Ask us anything" : "Leave your details"}</h2>
                  <p>{selling ? "Not sure which to choose? Leave your details and we'll get back to you." : `Leave your details and ${businessName} will be in touch.`}</p>
                </div>
                {(location || telHref) && (
                  <div className="cl-visit">
                    {location && <span>{location}</span>}
                    {telHref && <a href={telHref}>{phone}</a>}
                    {location && (
                      <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${businessName} ${location}`)}`} target="_blank" rel="noopener noreferrer">
                        Get directions
                      </a>
                    )}
                  </div>
                )}
              </div>
              <div className="cl-ask-form">
                <SignupForm token={signupToken} />
              </div>
            </div>
          </section>

          <footer className="cl-foot">
            <span>{businessName}</span>
            <span>{[location, phone].filter(Boolean).join(" · ")}</span>
          </footer>
        </div>
      </div>
    </>
  );
}
