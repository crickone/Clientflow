/**
 * Build the HTML for a Renova gift voucher email. Table-based, inline-styled,
 * cross-client safe. The "wow" lives on the web page the CTA links to —
 * this email is the polished envelope.
 */

import type { Voucher } from "./db/schema";

export interface VoucherEmailInput {
  voucher: Pick<
    Voucher,
    "code" | "valueEur" | "expiryDate" | "purchaserName" | "recipientName"
  > & { therapyName?: string | null; message?: string | null };
  baseUrl?: string;
}

const fmtEur = (n: number) =>
  new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${d} ${months[m - 1]} ${y}`;
};

export function renderVoucherEmail({
  voucher,
  baseUrl = "https://renovacellularhealth.ie",
}: VoucherEmailInput): { html: string; subject: string; preheader: string } {
  const value = fmtEur(voucher.valueEur);
  const expiry = fmtDate(voucher.expiryDate);
  const recipientName = voucher.recipientName || "you";
  const purchaserName = voucher.purchaserName;
  const url = `${baseUrl}/vouchers/${encodeURIComponent(voucher.code)}`;
  const subject = `${purchaserName} sent you a Renova gift voucher`;
  const preheader = `${value} towards your wellness recovery at Renova in Clonmel. Reveal your gift inside.`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeAttr(subject)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500&family=Hanken+Grotesk:wght@400;500;600&display=swap');
  body { margin:0; padding:0; background:#F1ECDF; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse; mso-table-lspace:0; mso-table-rspace:0; }
  img { border:0; line-height:100%; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  a { text-decoration:none; }
  @media (prefers-color-scheme: dark) {
    .force-light { background:#F1ECDF !important; color:#1A1410 !important; }
  }
</style>
</head>
<body class="force-light" style="margin:0;padding:0;background:#F1ECDF;font-family:'Hanken Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1A1410;">

<!-- Preheader -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#F1ECDF;opacity:0;">${escapeText(preheader)}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1ECDF;">
  <tr>
    <td align="center" style="padding:48px 16px;">

      <!-- Container -->
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

        <!-- Brand mark -->
        <tr>
          <td align="center" style="padding-bottom:36px;">
            <a href="${escapeAttr(baseUrl)}" target="_blank" style="text-decoration:none;display:inline-block;">
              <img src="${escapeAttr(baseUrl)}/renova-logo.png" alt="Renova Cellular Health" height="34" style="display:block;height:34px;width:auto;border:0;outline:none;text-decoration:none;">
            </a>
          </td>
        </tr>

        <!-- Eyebrow -->
        <tr>
          <td align="center" style="padding-bottom:8px;">
            <div style="font-family:'Hanken Grotesk',sans-serif;font-size:11px;letter-spacing:0.24em;color:#A39684;text-transform:uppercase;">A gift for ${escapeText(recipientName)}</div>
          </td>
        </tr>

        <!-- Headline -->
        <tr>
          <td align="center" style="padding-bottom:32px;">
            <h1 style="margin:0;font-family:'Fraunces',Georgia,serif;font-weight:400;font-size:36px;line-height:1.2;color:#1A1410;letter-spacing:-0.01em;">
              ${escapeText(purchaserName)} sent you<br><em style="font-style:italic;color:#5C2A30;">a moment to recover.</em>
            </h1>
          </td>
        </tr>

        <!-- Card preview (static, gradient-built) -->
        <tr>
          <td align="center" style="padding-bottom:36px;">
            <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:#1F1620;background-image:linear-gradient(135deg,#1F1620 0%,#3A1F2E 40%,#1F1620 100%);border-radius:20px;box-shadow:0 30px 60px -25px rgba(60,20,30,0.45),0 12px 24px -12px rgba(0,0,0,0.25);">
              <tr>
                <td style="padding:0;">
                  <table role="presentation" cellpadding="0" cellspacing="0" width="380" style="width:380px;">
                    <tr>
                      <td style="padding:28px 28px 0 28px;">
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                          <tr>
                            <td style="font-family:'Fraunces',Georgia,serif;font-size:11px;letter-spacing:0.32em;color:rgba(255,235,210,0.9);text-transform:uppercase;">Renova</td>
                            <td align="right" style="font-family:'Hanken Grotesk',sans-serif;font-size:9px;letter-spacing:0.28em;color:rgba(255,235,210,0.55);text-transform:uppercase;">Gift Voucher</td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td align="center" style="padding:24px 28px 28px 28px;">
                        <div style="font-family:'Fraunces',Georgia,serif;font-size:64px;line-height:1;color:#FFE9D6;font-weight:400;letter-spacing:-0.02em;">${value}</div>
                        <div style="font-family:'Hanken Grotesk',sans-serif;font-size:11px;letter-spacing:0.24em;color:rgba(255,235,210,0.65);text-transform:uppercase;margin-top:14px;">For ${escapeText(recipientName)}</div>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:0 28px 24px 28px;">
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid rgba(255,235,210,0.15);">
                          <tr>
                            <td style="padding-top:14px;font-family:'Hanken Grotesk',monospace;font-size:13px;letter-spacing:0.18em;color:rgba(255,235,210,0.85);">${escapeText(voucher.code)}</td>
                            <td align="right" style="padding-top:14px;font-family:'Hanken Grotesk',sans-serif;font-size:10px;letter-spacing:0.16em;color:rgba(255,235,210,0.5);text-transform:uppercase;">Exp ${escapeText(expiry)}</td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        ${
          voucher.message
            ? `
        <tr>
          <td align="center" style="padding-bottom:32px;">
            <table role="presentation" width="440" cellpadding="0" cellspacing="0" style="max-width:440px;">
              <tr>
                <td style="font-family:'Fraunces',Georgia,serif;font-style:italic;font-size:18px;line-height:1.5;color:#5C4733;text-align:center;border-top:1px solid #D9CFB8;border-bottom:1px solid #D9CFB8;padding:20px 0;">
                  &ldquo;${escapeText(voucher.message)}&rdquo;
                  <div style="font-family:'Hanken Grotesk',sans-serif;font-style:normal;font-size:10px;letter-spacing:0.24em;color:#A39684;text-transform:uppercase;margin-top:10px;">— ${escapeText(purchaserName)}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>`
            : ""
        }

        <!-- CTA -->
        <tr>
          <td align="center" style="padding-bottom:40px;">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td style="border-radius:999px;background:#1A1410;">
                  <a href="${escapeAttr(url)}" target="_blank" style="display:inline-block;padding:16px 40px;font-family:'Hanken Grotesk',sans-serif;font-size:13px;letter-spacing:0.18em;color:#F1ECDF;text-transform:uppercase;text-decoration:none;font-weight:500;">
                    Reveal Your Gift &rarr;
                  </a>
                </td>
              </tr>
            </table>
            <div style="margin-top:14px;font-family:'Hanken Grotesk',sans-serif;font-size:11px;color:#A39684;letter-spacing:0.04em;">Tap to see your animated gift card &amp; book your session.</div>
          </td>
        </tr>

        <!-- Details -->
        <tr>
          <td style="padding-bottom:40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #D9CFB8;">
              <tr>
                <td style="padding:24px 0 8px 0;font-family:'Hanken Grotesk',sans-serif;font-size:11px;letter-spacing:0.24em;color:#A39684;text-transform:uppercase;">Code</td>
                <td align="right" style="padding:24px 0 8px 0;font-family:'Hanken Grotesk',monospace;font-size:14px;letter-spacing:0.12em;color:#1A1410;">${escapeText(voucher.code)}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;font-family:'Hanken Grotesk',sans-serif;font-size:11px;letter-spacing:0.24em;color:#A39684;text-transform:uppercase;">Value</td>
                <td align="right" style="padding:8px 0;font-family:'Hanken Grotesk',sans-serif;font-size:14px;color:#1A1410;">${value}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;font-family:'Hanken Grotesk',sans-serif;font-size:11px;letter-spacing:0.24em;color:#A39684;text-transform:uppercase;">Valid until</td>
                <td align="right" style="padding:8px 0;font-family:'Hanken Grotesk',sans-serif;font-size:14px;color:#1A1410;">${escapeText(expiry)}</td>
              </tr>
              ${
                voucher.therapyName
                  ? `
              <tr>
                <td style="padding:8px 0;font-family:'Hanken Grotesk',sans-serif;font-size:11px;letter-spacing:0.24em;color:#A39684;text-transform:uppercase;">For</td>
                <td align="right" style="padding:8px 0;font-family:'Hanken Grotesk',sans-serif;font-size:14px;color:#1A1410;">${escapeText(voucher.therapyName)}</td>
              </tr>`
                  : ""
              }
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td align="center" style="padding-top:24px;border-top:1px solid #D9CFB8;">
            <img src="${escapeAttr(baseUrl)}/renova-logo.png" alt="Renova Cellular Health" height="22" style="display:inline-block;height:22px;width:auto;border:0;opacity:0.7;margin-bottom:10px;">
            <div style="font-family:'Hanken Grotesk',sans-serif;font-size:11px;color:#A39684;margin-top:4px;line-height:1.6;">
              Ard Gaoithe Business Park, Clonmel, Co. Tipperary<br>
              <a href="${escapeAttr(baseUrl)}" style="color:#A39684;text-decoration:underline;">renovacellularhealth.ie</a> &nbsp;·&nbsp; 083 867 2844
            </div>
          </td>
        </tr>
      </table>

    </td>
  </tr>
</table>

</body>
</html>`;

  return { html, subject, preheader };
}

function escapeText(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}
