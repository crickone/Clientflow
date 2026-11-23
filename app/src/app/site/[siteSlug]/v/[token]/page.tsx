/**
 * The recipient's gift page, /v/<token> on the business's own site. The
 * token is the voucher's unguessable view_token, separate from the short
 * code staff take at the desk. Inside the site's own chrome, with the site's
 * consent-gated tracking like every public page. Never indexed.
 *
 * The voucher is looked up by token only, inside the host-resolved tenant. A
 * wrong or malformed token shows the plain not-found page. A cancelled voucher
 * shows a notice-only page (no card, code, balance or expiry).
 *
 * NAMESPACE NOTE: reserves /v/* on every site, ahead of the CMS catch-all,
 * the same accepted cost as /c/* for campaign pages.
 */
import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { notFound } from "next/navigation";

import { resolvePublicSite, type PublicSite } from "@/lib/cms/resolveHost";
import { siteRequestHost } from "@/lib/cms/requestHost";
import { CHROME_CONTENT_CSS, getSiteChrome } from "@/lib/cms/siteChrome";
import { runWithTenant } from "@/lib/db/tenant";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { SiteTracking } from "@/components/cms/SiteTracking";
import { RevealCard } from "@/components/vouchers/RevealCard";
import { PrintButton } from "@/components/vouchers/PrintButton";
import {
  balanceLabel,
  colourways,
  dublinDate,
  formatEuro,
  formatLongDate,
  parseColourway,
  voucherState,
  voucherTitle,
} from "@/lib/vouchers/model";
import { brandPaletteForTenant, getStoreSettings, getVoucherByViewToken, therapyName } from "@/lib/vouchers/store";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ siteSlug: string; token: string }>;
  searchParams: Promise<{ site?: string }>;
};

function load(site: PublicSite, token: string) {
  return runWithTenant(site.tenantId, () => {
    const v = getVoucherByViewToken(token);
    if (!v) return null;
    if (v.cancelledAt) return { cancelled: true as const };
    const colourway = parseColourway(v.colourway) ?? colourways(brandPaletteForTenant(site.tenantId))[0]!;
    return { cancelled: false as const, v, colourway, therapy: therapyName(v.therapyId), bookUrl: getStoreSettings().bookUrl };
  });
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const resolved = resolvePublicSite({ host: siteRequestHost(), siteParam: searchParams.site ?? params.siteSlug });
  const data = resolved ? load(resolved, params.token) : null;
  return {
    title: data && !data.cancelled ? `A gift from ${data.v.purchaserName} | ${resolved!.site.name}` : "Gift voucher",
    robots: { index: false, follow: false },
  };
}

export default async function GiftPage(props: Props) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const resolved = resolvePublicSite({ host: siteRequestHost(), siteParam: searchParams.site ?? params.siteSlug });
  if (!resolved) notFound();
  const data = load(resolved, params.token);
  if (!data) notFound();
  const business = getBusinessProfileForTenant(resolved.tenantId);
  const chrome = getSiteChrome(resolved.db, resolved.site.id, resolved.resolvedVia === "host" ? resolved.site.slug : null);
  if (data.cancelled) {
    const cPhoneHref = business.phone ? `tel:${business.phone.replace(/[^0-9+]/g, "")}` : null;
    return (
      <>
        <SiteTracking siteSlug={resolved.site.slug} pixelId={resolved.site.metaPixelId} googleTagId={resolved.site.googleTagId} />
        <div dangerouslySetInnerHTML={{ __html: chrome.head }} />
        <style dangerouslySetInnerHTML={{ __html: CHROME_CONTENT_CSS + GIFT_CSS }} />
        {chrome.header && <div dangerouslySetInnerHTML={{ __html: chrome.header }} />}
        <main className="cms-shell cms-shell--narrow vg">
          <h1>Gift voucher</h1>
          <p className="vg__how vg__how--plain">
            This voucher is no longer valid. Contact {business.businessName} if you have questions.
          </p>
          {cPhoneHref && business.phone ? (
            <p className="vg__how vg__how--plain">
              <a href={cPhoneHref}>{business.phone}</a>
            </p>
          ) : business.email ? (
            <p className="vg__how vg__how--plain">
              <a href={`mailto:${business.email}`}>{business.email}</a>
            </p>
          ) : null}
        </main>
        {chrome.footer && <div dangerouslySetInnerHTML={{ __html: chrome.footer }} />}
        {chrome.tail && <div dangerouslySetInnerHTML={{ __html: chrome.tail }} />}
      </>
    );
  }
  const { v, colourway, therapy, bookUrl } = data;
  const state = voucherState(v, dublinDate(Date.now()));
  const title = voucherTitle({ kind: v.kind, valueEur: v.valueEur, therapyName: therapy });
  const forName = v.recipientName || "you";
  const phoneHref = business.phone ? `tel:${business.phone.replace(/[^0-9+]/g, "")}` : null;
  const bookHref = bookUrl || phoneHref || (business.email ? `mailto:${business.email}` : null);
  const notice =
    state === "used"
      ? "This voucher has been used."
      : state === "expired"
        ? `This voucher's date has passed. Contact ${business.businessName} to use it.`
        : null;

  return (
    <>
      <SiteTracking siteSlug={resolved.site.slug} pixelId={resolved.site.metaPixelId} googleTagId={resolved.site.googleTagId} />
      <div dangerouslySetInnerHTML={{ __html: chrome.head }} />
      <style dangerouslySetInnerHTML={{ __html: CHROME_CONTENT_CSS + GIFT_CSS }} />
      {chrome.header && <div dangerouslySetInnerHTML={{ __html: chrome.header }} />}

      <main className="cms-shell cms-shell--narrow vg">
        <div className="vg__reveal">
          <p className="vg__eyebrow">A gift for {forName}</p>
          <h1>{v.purchaserName} sent you a gift</h1>
        </div>
        <div className="vg__card">
          <RevealCard
            colourway={colourway}
            businessName={business.businessName}
            title={title}
            forName={forName}
            code={v.code}
            expiryLabel={`Valid until ${formatLongDate(v.expiryDate)}`}
          />
        </div>
        {v.message && (
          <blockquote className="vg__message">
            &ldquo;{v.message}&rdquo;
            <cite>{v.purchaserName}</cite>
          </blockquote>
        )}
        {notice && <p className="vg__notice">{notice}</p>}
        <dl className="vg__details">
          <div>
            <dt>Code</dt>
            <dd className="vg__mono">{v.code}</dd>
          </div>
          <div>
            <dt>{v.kind === "treatment" ? "Treatment" : "Value"}</dt>
            <dd>{v.kind === "treatment" ? title : formatEuro(v.valueEur)}</dd>
          </div>
          <div>
            <dt>Left</dt>
            <dd>{balanceLabel(v)}</dd>
          </div>
          <div>
            <dt>Valid until</dt>
            <dd>{formatLongDate(v.expiryDate)}</dd>
          </div>
        </dl>
        <div className="vg__actions">
          {bookHref && (state === "active" || state === "part_used") && (
            <a
              className="vg__book"
              href={bookHref}
              style={
                {
                  background: colourway.base,
                  color: colourway.ink,
                  "--vb-base": colourway.base,
                  "--vb-ink": colourway.ink,
                } as CSSProperties
              }
            >
              Book with this voucher
            </a>
          )}
          <PrintButton
            className="vg__print"
            style={{ "--vb-base": colourway.base, "--vb-ink": colourway.ink } as CSSProperties}
          />
        </div>
        <p className="vg__how">
          {business.phone
            ? `To book, call ${business.phone} and give your code.`
            : `To book, contact ${business.businessName} and give your code.`}
        </p>
      </main>

      {chrome.footer && <div dangerouslySetInnerHTML={{ __html: chrome.footer }} />}
      {chrome.tail && <div dangerouslySetInnerHTML={{ __html: chrome.tail }} />}
    </>
  );
}

const GIFT_CSS = `
.vg{text-align:center}
.vg__reveal{animation:vg-rise .8s ease both}
.vg__eyebrow{font-size:12px;letter-spacing:.24em;text-transform:uppercase;opacity:.7;margin:0 0 14px}
.vg h1{font-size:clamp(30px,6vw,52px);line-height:1.1;margin:0 0 clamp(28px,5vw,44px)}
.vg__card{animation:vg-card 1.1s cubic-bezier(.2,.85,.3,1) .25s both}
.vg__message{margin:clamp(28px,5vw,40px) auto 0;max-width:30em;font-size:clamp(17px,2.2vw,20px);font-style:italic;line-height:1.6;overflow-wrap:anywhere;white-space:pre-line}
.vg__message cite{display:block;margin-top:10px;font-style:normal;font-size:12px;letter-spacing:.2em;text-transform:uppercase;opacity:.7}
.vg__notice{margin:24px auto 0;max-width:34em;padding:12px 16px;border:1px solid currentColor;border-radius:10px;font-weight:600}
.vg__details{margin:clamp(28px,5vw,40px) auto 0;max-width:440px;padding:0;text-align:left;border-top:1px solid rgba(127,127,127,.4)}
.vg__details > div{display:flex;justify-content:space-between;gap:16px;padding:14px 0;border-bottom:1px solid rgba(127,127,127,.4)}
.vg__details dt{font-size:12px;letter-spacing:.18em;text-transform:uppercase;opacity:.7;margin:0}
.vg__details dd{margin:0;text-align:right;overflow-wrap:anywhere}
.vg__mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.12em}
.vg__actions{display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin-top:clamp(26px,4vw,36px)}
.vg__book,.vg__print{display:inline-flex;align-items:center;justify-content:center;min-height:50px;padding:0 24px;border-radius:999px;font:inherit;font-weight:600;font-size:16px;text-decoration:none;cursor:pointer}
.vg__book{border:0}
.vg__print{background:transparent;color:inherit;border:1px solid currentColor}
.vg__book:focus-visible,.vg__print:focus-visible{outline:2px solid var(--vb-base,currentColor);outline-offset:2px;box-shadow:0 0 0 4px var(--vb-ink,#fff)}
.vg__how{margin:18px 0 0;font-size:14px;opacity:.75}
.vg__how--plain{font-size:16px;opacity:1}
@keyframes vg-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes vg-card{0%{opacity:0;transform:translateY(36px) scale(.92)}60%{opacity:1}100%{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.vg__reveal,.vg__card{animation:none}}
@media print{
  header,footer,nav,.vg__actions{display:none!important}
  .vg__card{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .vg__reveal,.vg__card{animation:none}
  body{background:#fff!important;color:#000!important}
}
`;
