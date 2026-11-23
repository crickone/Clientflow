/**
 * The voucher store, at /vouchers on the business's own site (its domain in
 * production; the middleware rewrites /vouchers there to this route).
 *
 * Inside the site's own chrome (lib/cms/siteChrome): its stylesheet, navbar
 * and footer, like the blog, because the store is part of the website.
 *
 * NAMESPACE NOTE: this static route is picked ahead of the [...slug]
 * catch-all for /vouchers on every site. While the store is OFF, a site that
 * has its own published /vouchers page gets that page, exactly as the blog
 * route defers to a site's own /blog; a site with neither gets a 404.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { resolvePublicSite, siteUrl, type PublicSite } from "@/lib/cms/resolveHost";
import { siteRequestHost } from "@/lib/cms/requestHost";
import { CHROME_CONTENT_CSS, getSiteChrome } from "@/lib/cms/siteChrome";
import { resolvePageContext, siteVerificationMeta } from "@/lib/cms/render";
import { runWithTenant } from "@/lib/db/tenant";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { getCheckoutSession } from "@/lib/stripe/api";
import { canTakePayments, getStripeConnection } from "@/lib/stripe/connection";
import { SiteTracking } from "@/components/cms/SiteTracking";
import { SiteBeacon } from "@/components/cms/SiteBeacon";
import { RevealCard } from "@/components/vouchers/RevealCard";
import { VoucherBuilder } from "@/components/vouchers/VoucherBuilder";
import { fulfilVoucherCheckout } from "@/lib/vouchers/fulfil";
import {
  colourways,
  dublinDate,
  formatLongDate,
  parseColourway,
  voucherTitle,
  type Colourway,
  type DeliverTo,
} from "@/lib/vouchers/model";
import {
  brandPaletteForTenant,
  getStoreSettings,
  getVoucherById,
  getVoucherOrder,
  storeFlagOn,
  storeTreatments,
  therapyName,
} from "@/lib/vouchers/store";
import { signVoucherStoreToken, siteRootUrl } from "@/lib/vouchers/storeToken";

import PublicSitePage, { generateMetadata as pageMetadata } from "../[...slug]/page";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ siteSlug: string }>;
  searchParams: Promise<{ site?: string; paid?: string; session_id?: string }>;
};

const PATH = ["vouchers"];

function storeOpen(site: PublicSite): boolean {
  return storeFlagOn(site.tenantId) && runWithTenant(site.tenantId, () => getStoreSettings().enabled);
}

function ownsVouchersPage(siteSlug: string, site?: string): boolean {
  const pc = resolvePageContext({ siteSlug, slug: PATH }, { site });
  return Boolean(pc && pc.template);
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const host = siteRequestHost();
  const resolved = resolvePublicSite({ host, siteParam: searchParams.site ?? params.siteSlug });
  if (!resolved) return { title: "Not found" };
  if (!storeOpen(resolved)) {
    if (ownsVouchersPage(params.siteSlug, searchParams.site)) {
      return pageMetadata({ params: Promise.resolve({ siteSlug: params.siteSlug, slug: PATH }), searchParams: Promise.resolve({ site: searchParams.site }) });
    }
    return { title: "Not found" };
  }
  const p = getBusinessProfileForTenant(resolved.tenantId);
  const town = p.location.split(",")[0]?.trim() ?? "";
  const years = runWithTenant(resolved.tenantId, () => getStoreSettings().expiryYears);
  const title = `Gift Vouchers${town ? ` ${town}` : ""} | ${resolved.site.name}`;
  const description = `Buy a ${resolved.site.name} gift voucher online. Choose an amount or a treatment, add a message and send it by email. Valid for ${years} years.`;
  const canonical = siteUrl(resolved, "/vouchers", host);
  return {
    title,
    description,
    alternates: { canonical },
    verification: siteVerificationMeta(resolved.site),
    openGraph: { title, description, url: canonical, siteName: resolved.site.name, type: "website" },
    // The thank-you view carries an order number: never indexed.
    robots: searchParams.paid ? { index: false, follow: false } : { index: true, follow: true },
  };
}

interface Thanks {
  status: "paid" | "processing";
  colourway: Colourway;
  title: string;
  toName: string;
  buyerEmail: string;
  deliverTo: DeliverTo;
  recipientEmail: string | null;
  deliverOn: string | null;
  code: string | null;
  expiry: string | null;
  revealUrl: string | null;
}

/**
 * The buyer back from Stripe (?paid=<order>&session_id=<session>). If the
 * webhook hasn't landed yet, ask Stripe and fulfil here (the claim inside
 * fulfilVoucherCheckout keeps it to one voucher). Only a session id that
 * matches the order counts, so a guessed order number shows nothing.
 */
async function purchaseState(tenantId: number, sp: Awaited<Props["searchParams"]>): Promise<Thanks | null> {
  const orderId = Number(sp.paid);
  const sessionId = String(sp.session_id ?? "");
  if (!Number.isInteger(orderId) || orderId <= 0 || !sessionId.startsWith("cs_")) return null;
  let order = runWithTenant(tenantId, () => getVoucherOrder(orderId));
  if (!order || order.stripeSessionId !== sessionId) return null;
  if (order.status === "pending" || order.status === "expired") {
    const s = await getCheckoutSession(order.stripeAccountId, sessionId);
    if (s.ok && s.data.client_reference_id === String(order.id)) await fulfilVoucherCheckout(tenantId, order.stripeAccountId, s.data);
    order = runWithTenant(tenantId, () => getVoucherOrder(orderId));
  }
  if (!order || (order.status !== "paid" && order.status !== "pending")) return null;
  const o = order;
  return runWithTenant(tenantId, () => {
    const v = o.giftVoucherId ? getVoucherById(o.giftVoucherId) : null;
    return {
      status: o.status === "paid" ? ("paid" as const) : ("processing" as const),
      colourway: parseColourway(o.colourway) ?? colourways(brandPaletteForTenant(tenantId))[0]!,
      title: voucherTitle({ kind: o.kind, valueEur: o.valueCents / 100, therapyName: therapyName(o.therapyId) }),
      toName: o.recipientName,
      buyerEmail: o.buyerEmail,
      deliverTo: o.deliverTo,
      recipientEmail: o.recipientEmail,
      deliverOn: o.deliverOn,
      code: v?.code ?? null,
      expiry: v?.expiryDate ?? null,
      revealUrl: v?.viewToken ? `${o.siteUrl}/v/${v.viewToken}` : null,
    };
  });
}

export default async function VoucherStorePage(props: Props) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const host = siteRequestHost();
  const resolved = resolvePublicSite({ host, siteParam: searchParams.site ?? params.siteSlug });
  if (!resolved) notFound();
  if (!storeOpen(resolved)) {
    if (ownsVouchersPage(params.siteSlug, searchParams.site)) {
      return PublicSitePage({ params: Promise.resolve({ siteSlug: params.siteSlug, slug: PATH }), searchParams: Promise.resolve({ site: searchParams.site }) });
    }
    notFound();
  }

  const tid = resolved.tenantId;
  const business = getBusinessProfileForTenant(tid);
  const chrome = getSiteChrome(resolved.db, resolved.site.id, resolved.resolvedVia === "host" ? resolved.site.slug : null);
  const purchase = searchParams.paid ? await purchaseState(tid, searchParams) : null;
  const store = runWithTenant(tid, () => {
    const settings = getStoreSettings();
    return { settings, treatments: storeTreatments(settings.therapyIds), palette: colourways(brandPaletteForTenant(tid)) };
  });
  const ready = canTakePayments(getStripeConnection(tid));
  const token = ready ? signVoucherStoreToken({ tenantId: tid, siteId: resolved.site.id, siteUrl: siteRootUrl(resolved, host) }) : null;

  return (
    <>
      <SiteTracking siteSlug={resolved.site.slug} pixelId={resolved.site.metaPixelId} googleTagId={resolved.site.googleTagId} />
      <SiteBeacon />
      <div dangerouslySetInnerHTML={{ __html: chrome.head }} />
      <style dangerouslySetInnerHTML={{ __html: CHROME_CONTENT_CSS + THANKS_CSS }} />
      {chrome.header && <div dangerouslySetInnerHTML={{ __html: chrome.header }} />}

      <main>
        {purchase ? (
          <section className="cms-shell vt">
            <div className="vt__card">
              <RevealCard
                colourway={purchase.colourway}
                businessName={business.businessName}
                title={purchase.title}
                forName={purchase.toName}
                code={purchase.code ?? "Your code"}
                expiryLabel={purchase.expiry ? `Valid until ${formatLongDate(purchase.expiry)}` : "Gift voucher"}
              />
            </div>
            <div className="vt__text">
              <h1>Thank you</h1>
              {purchase.status === "paid" ? (
                <>
                  <p>Your voucher is paid. Your receipt is on its way to {purchase.buyerEmail}.</p>
                  <p>
                    {purchase.deliverTo === "buyer"
                      ? "The voucher is in that email. You can open it now too."
                      : purchase.deliverOn
                        ? `We will email it to ${purchase.toName} on ${formatLongDate(purchase.deliverOn)} at 9am.`
                        : `We have emailed it to ${purchase.toName}.`}
                  </p>
                  {purchase.revealUrl && (
                    <p>
                      <a className="vt__link" href={purchase.revealUrl}>
                        Open the voucher
                      </a>
                    </p>
                  )}
                </>
              ) : (
                <p>We are confirming your payment with Stripe. Your receipt will arrive by email in a few minutes.</p>
              )}
            </div>
          </section>
        ) : (
          <VoucherBuilder
            token={token}
            businessName={business.businessName}
            phone={business.phone}
            intro={store.settings.intro}
            settings={store.settings}
            treatments={store.treatments}
            colourways={store.palette}
            today={dublinDate(Date.now())}
          />
        )}
      </main>

      {chrome.footer && <div dangerouslySetInnerHTML={{ __html: chrome.footer }} />}
      {chrome.tail && <div dangerouslySetInnerHTML={{ __html: chrome.tail }} />}
    </>
  );
}

const THANKS_CSS = `
.vt{display:grid;gap:clamp(28px,4vw,56px);align-items:center}
@media(min-width:900px){.vt{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
.vt__text h1{font-size:clamp(34px,6vw,60px);line-height:1.05;margin:0 0 .4em}
.vt__text p{margin:0 0 .8em;line-height:1.6;max-width:52ch}
.vt__link{display:inline-flex;align-items:center;min-height:48px;padding:0 22px;border-radius:999px;border:1px solid currentColor;text-decoration:none;font-weight:600}
`;
