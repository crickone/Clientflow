import "server-only";

import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { getSiteChrome, headerLogoSrc } from "@/lib/cms/siteChrome";
import { getTenantDbById } from "@/lib/db/tenant";
import {
  escapeHtml,
  getEmailProviderForTenant,
  renderEmailShell,
  sendEmailForTenant,
  sendPlatformEmail,
  textToParagraphs,
  type SendResult,
} from "@/lib/email";
import { formatEuro, formatLongDate, type Colourway, type DeliverTo } from "./model";

/**
 * The two voucher emails, branded per business: the buyer's receipt and the
 * recipient's gift. Sent from the business's own sender (Gmail, SMTP or its
 * Resend domain); a business with none, or whose sender fails, falls back to
 * the platform sender as "<Business> via AdonisAgent" with replies going to
 * the business. That fallback is a deliberate exception to "platform email
 * is for account notices", limited to these two emails, so a paid voucher is
 * never left undelivered.
 */

export interface VoucherMail {
  to: string;
  subject: string;
  html: string;
}

export type VoucherMailer = (tenantId: number, mail: VoucherMail) => Promise<SendResult>;

export interface VoucherBrand {
  businessName: string;
  email: string;
  phone: string;
  website: string;
  /** An absolute raster logo URL, or null (Gmail drops SVG and data: images). */
  logoUrl: string | null;
}

/** The site header's logo as an absolute URL an inbox can load, or null. */
export function absoluteLogoUrl(src: string | null, siteUrl: string | null): string | null {
  if (!src || src.startsWith("data:") || /\.svg(\?|$)/i.test(src)) return null;
  if (/^https?:\/\//.test(src)) return src;
  if (!src.startsWith("/") || !siteUrl) return null;
  try {
    return `${new URL(siteUrl).origin}${src}`;
  } catch {
    return null;
  }
}

export function voucherBrand(tenantId: number, siteId: number | null, siteUrl: string | null): VoucherBrand {
  const p = getBusinessProfileForTenant(tenantId);
  let logoUrl: string | null = null;
  if (siteId) {
    try {
      logoUrl = absoluteLogoUrl(headerLogoSrc(getSiteChrome(getTenantDbById(tenantId), siteId).header), siteUrl);
    } catch {
      logoUrl = null;
    }
  }
  return { businessName: p.businessName, email: p.email, phone: p.phone, website: p.website, logoUrl };
}

export async function sendVoucherEmail(tenantId: number, mail: VoucherMail): Promise<SendResult> {
  if (getEmailProviderForTenant(tenantId) !== "none") {
    const r = await sendEmailForTenant(tenantId, mail);
    if (r.ok) return r;
    console.error(`[vouchers] tenant ${tenantId} sender failed, trying the platform sender:`, r.error);
  }
  const p = getBusinessProfileForTenant(tenantId);
  return sendPlatformEmail({ ...mail, fromName: `${p.businessName} via AdonisAgent`, replyTo: p.email || undefined });
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** The card, as an email can draw it: no foil, the colourway's ground and ink. */
function cardHtml(c: Colourway, businessName: string, title: string, forName: string, code: string, expiry: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:380px;margin:0 auto;border-collapse:separate;border-radius:18px;background:${c.base};background-image:linear-gradient(135deg,${c.base} 0%,${c.base2} 100%);">
  <tr><td style="padding:24px 26px 0;font-family:${FONT};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:${c.ink};">${escapeHtml(businessName)}</td>
      <td align="right" style="font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:${c.ink};opacity:.7;">Gift voucher</td>
    </tr></table>
  </td></tr>
  <tr><td align="center" style="padding:26px 26px 22px;font-family:${FONT};color:${c.ink};">
    <div style="font-size:40px;line-height:1.1;font-weight:600;">${escapeHtml(title)}</div>
    <div style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;margin-top:10px;opacity:.8;">For ${escapeHtml(forName)}</div>
  </td></tr>
  <tr><td style="padding:0 26px 22px;font-family:${FONT};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${c.foil[1]};"><tr>
      <td style="padding-top:12px;font-family:Menlo,Consolas,monospace;font-size:13px;letter-spacing:.14em;color:${c.ink};">${escapeHtml(code)}</td>
      <td align="right" style="padding-top:12px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:${c.ink};opacity:.7;">Valid until ${escapeHtml(formatLongDate(expiry))}</td>
    </tr></table>
  </td></tr>
</table>`;
}

function button(href: string, label: string, c: Colourway): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px auto 6px;"><tr>
  <td style="border-radius:999px;background:${c.base};"><a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 30px;font-family:${FONT};font-size:14px;font-weight:600;color:${c.ink};text-decoration:none;">${escapeHtml(label)}</a></td>
</tr></table>`;
}

function contactLine(b: VoucherBrand): string {
  return [b.phone && `call ${b.phone}`, b.email && `email ${b.email}`].filter(Boolean).join(" or ");
}

export interface GiftEmailInput {
  brand: VoucherBrand;
  colourway: Colourway;
  fromName: string;
  toName: string;
  message: string | null;
  title: string;
  code: string;
  expiry: string;
  revealUrl: string;
}

/** To the recipient: "<From> sent you a gift", the card and one button. */
export function renderGiftEmail(i: GiftEmailInput): { subject: string; html: string } {
  const c = i.colourway;
  const contact = contactLine(i.brand);
  const logo = i.brand.logoUrl
    ? `<img src="${escapeHtml(i.brand.logoUrl)}" alt="${escapeHtml(i.brand.businessName)}" height="36" style="display:block;margin:0 auto;height:36px;width:auto;border:0;">`
    : `<div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#111827;">${escapeHtml(i.brand.businessName)}</div>`;
  const message = i.message
    ? `<p style="margin:0 auto 22px;max-width:420px;font-size:17px;line-height:1.6;font-style:italic;color:#374151;text-align:center;">&ldquo;${escapeHtml(i.message)}&rdquo;</p>`
    : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(i.fromName)} sent you a gift</title></head>
<body style="margin:0;background:#f3f4f6;padding:24px 12px;font-family:${FONT};color:#111827;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;border:1px solid #e5e7eb;">
  <tr><td align="center" style="padding:32px 24px 8px;">${logo}</td></tr>
  <tr><td align="center" style="padding:18px 24px 6px;">
    <h1 style="margin:0;font-size:26px;line-height:1.25;font-weight:700;color:#111827;">${escapeHtml(i.fromName)} sent you a gift</h1>
  </td></tr>
  <tr><td style="padding:22px 24px 8px;">${cardHtml(c, i.brand.businessName, i.title, i.toName, i.code, i.expiry)}</td></tr>
  <tr><td style="padding:16px 24px 0;">${message}${button(i.revealUrl, "Open your gift", c)}</td></tr>
  <tr><td align="center" style="padding:10px 24px 28px;font-size:13px;line-height:1.6;color:#6b7280;">
    ${contact ? `To book, ${escapeHtml(contact)}. Give them your code.` : "Give your code when you book."}
  </td></tr>
  <tr><td style="padding:0 24px 24px;"><div style="border-top:1px solid #e5e7eb;padding-top:14px;font-size:12px;color:#9ca3af;text-align:center;">Sent by ${escapeHtml(i.brand.businessName)}${i.brand.website ? ` &middot; ${escapeHtml(i.brand.website)}` : ""}</div></td></tr>
</table>
</body></html>`;
  return { subject: `${i.fromName} sent you a gift from ${i.brand.businessName}`, html };
}

export interface ReceiptEmailInput {
  brand: VoucherBrand;
  colourway: Colourway;
  buyerName: string;
  toName: string;
  title: string;
  paidEur: number;
  code: string;
  expiry: string;
  revealUrl: string;
  deliverTo: DeliverTo;
  recipientEmail: string | null;
  deliverOn: string | null;
}

/** To the buyer: what they paid, the card, the voucher link, and what happens next. */
export function renderReceiptEmail(i: ReceiptEmailInput): { subject: string; html: string } {
  const first = i.buyerName.split(/\s+/)[0] || "";
  const next =
    i.deliverTo === "buyer"
      ? "Here is your voucher. Print it or forward this email."
      : i.deliverOn
        ? `We will email it to ${i.toName} at ${i.recipientEmail} on ${formatLongDate(i.deliverOn)} at 9am.`
        : `We have emailed it to ${i.toName} at ${i.recipientEmail}.`;
  const contact = contactLine(i.brand);
  const bodyHtml = `
    ${textToParagraphs(`${first ? `Thanks, ${first}.` : "Thanks."} You paid ${formatEuro(i.paidEur)} for a gift voucher for ${i.toName}.`)}
    ${textToParagraphs(next)}
    <div style="margin:18px 0;">${cardHtml(i.colourway, i.brand.businessName, i.title, i.toName, i.code, i.expiry)}</div>
    ${button(i.revealUrl, "Open the voucher", i.colourway)}
    ${textToParagraphs(`Code ${i.code}. Valid until ${formatLongDate(i.expiry)}.${contact ? ` To book, ${contact}.` : ""}`)}`;
  const html = renderEmailShell({
    businessName: i.brand.businessName,
    accent: i.colourway.base,
    heading: "Your gift voucher",
    bodyHtml,
    footer: `Sent by ${i.brand.businessName}.`,
    logoUrl: i.brand.logoUrl ?? undefined,
    logoWidth: 160,
  });
  return { subject: `Your ${i.brand.businessName} gift voucher`, html };
}
