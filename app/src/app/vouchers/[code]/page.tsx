import Image from "next/image";
import { notFound } from "next/navigation";
import { getVoucherByCode } from "@/lib/queries";
import { HolographicCard } from "./HolographicCard";
import { CopyButton } from "./CopyButton";

export const dynamic = "force-dynamic";

interface Props {
  params: { code: string };
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
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${d} ${months[m - 1]} ${y}`;
};

const fmtDateLong = (iso: string) => {
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

// Mock voucher used when the code === "demo" and no real row exists, so the
// page is openable for design preview without seeding the DB.
const DEMO_VOUCHER = {
  code: "DEMO-2026-RNV",
  valueEur: 150,
  expiryDate: "2027-05-10",
  purchaserName: "Aoife Murphy",
  recipientName: "Cillian",
  message:
    "For all the late nights and early mornings — go take an hour for yourself. You've earned it.",
  therapyName: null as string | null,
};

export default async function VoucherPublicPage({ params }: Props) {
  const code = decodeURIComponent(params.code);

  let voucher: {
    code: string;
    valueEur: number;
    expiryDate: string;
    purchaserName: string;
    recipientName: string | null;
    message?: string | null;
    therapyName?: string | null;
  } | null = null;

  const isDemoCode =
    code.toLowerCase() === "demo" || code.toUpperCase().startsWith("DEMO-");
  if (isDemoCode) {
    voucher = { ...DEMO_VOUCHER, code };
  } else {
    const row = await getVoucherByCode(code);
    if (!row) notFound();
    voucher = {
      code: row.code,
      valueEur: row.valueEur,
      expiryDate: row.expiryDate,
      purchaserName: row.purchaserName,
      recipientName: row.recipientName,
      message: null,
      therapyName: null,
    };
  }

  const valueLabel = fmtEur(voucher.valueEur);
  const expiryLabel = fmtDate(voucher.expiryDate);
  const recipientName = voucher.recipientName || "you";

  return (
    <main className="voucher-page">
      <div className="grain-overlay" />

      <header className="brand-mark">
        <Image
          src="/renova-logo.png"
          alt="Renova Cellular Health"
          width={780}
          height={120}
          priority
          className="brand-logo"
        />
      </header>

      <div className="reveal">
        <div className="eyebrow">A gift for {recipientName}</div>
        <h1 className="headline">
          {voucher.purchaserName} sent you
          <br />
          <em>a moment to recover.</em>
        </h1>
      </div>

      <div className="card-stage">
        <HolographicCard
          recipientName={recipientName}
          valueLabel={valueLabel}
          code={voucher.code}
          expiryLabel={expiryLabel}
        />
      </div>

      {voucher.message && (
        <blockquote className="message">
          <span className="quote-mark">&ldquo;</span>
          {voucher.message}
          <span className="quote-mark">&rdquo;</span>
          <cite>— {voucher.purchaserName}</cite>
        </blockquote>
      )}

      <div className="actions">
        <a href="https://renovacellularhealth.ie/book" className="btn-primary">
          Book Your Session
        </a>
        <CopyButton code={voucher.code} />
      </div>

      <dl className="details">
        <div>
          <dt>Code</dt>
          <dd className="mono">{voucher.code}</dd>
        </div>
        <div>
          <dt>Value</dt>
          <dd>{valueLabel}</dd>
        </div>
        <div>
          <dt>Valid until</dt>
          <dd>{fmtDateLong(voucher.expiryDate)}</dd>
        </div>
        {voucher.therapyName && (
          <div>
            <dt>For</dt>
            <dd>{voucher.therapyName}</dd>
          </div>
        )}
      </dl>

      <footer className="page-footer">
        <Image
          src="/renova-logo.png"
          alt="Renova Cellular Health"
          width={780}
          height={120}
          className="footer-logo"
        />
        <div className="footer-line">
          Ard Gaoithe Business Park, Clonmel, Co. Tipperary
        </div>
        <div className="footer-line">
          <a href="https://renovacellularhealth.ie">renovacellularhealth.ie</a>{" "}
          &nbsp;·&nbsp; 083 867 2844
        </div>
      </footer>

      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;1,9..144,400&family=JetBrains+Mono:wght@400;500&display=swap"
      />

      <style
        dangerouslySetInnerHTML={{
          __html: `
        :root {
          --paper: #F1ECDF;
          --paper-warm: #EAE3D1;
          --ink: #1A1410;
          --ink-soft: #5C4733;
          --ink-fade: #A39684;
          --hairline: #D9CFB8;
          --accent: #5C2A30;
        }

        body {
          background: var(--paper);
          color: var(--ink);
          font-family: var(--font-body), -apple-system, sans-serif;
        }

        .voucher-page {
          min-height: 100vh;
          max-width: 640px;
          margin: 0 auto;
          padding: 56px 24px 80px;
          background:
            radial-gradient(ellipse 800px 600px at 50% -10%, rgba(255, 220, 195, 0.5), transparent),
            linear-gradient(180deg, var(--paper) 0%, var(--paper-warm) 100%);
          position: relative;
          overflow: hidden;
        }

        .grain-overlay {
          position: fixed;
          inset: 0;
          pointer-events: none;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.4  0 0 0 0 0.3  0 0 0 0 0.2  0 0 0 0.05 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
          opacity: 0.6;
          mix-blend-mode: multiply;
          z-index: 1;
        }

        .voucher-page > * {
          position: relative;
          z-index: 2;
        }

        .brand-mark {
          text-align: center;
          margin-bottom: 56px;
          opacity: 0;
          animation: fade-in 0.7s ease forwards;
        }
        :global(.brand-logo) {
          width: auto !important;
          height: 38px !important;
          opacity: 0.9;
        }

        .reveal {
          text-align: center;
          margin-bottom: 56px;
          opacity: 0;
          animation: fade-rise 0.9s ease 0.15s forwards;
        }
        .eyebrow {
          font-size: 11px;
          letter-spacing: 0.32em;
          text-transform: uppercase;
          color: var(--ink-fade);
          margin-bottom: 18px;
        }
        .headline {
          font-family: "Fraunces", Georgia, serif;
          font-weight: 400;
          font-size: clamp(30px, 6vw, 44px);
          line-height: 1.18;
          letter-spacing: -0.015em;
          color: var(--ink);
          margin: 0;
        }
        .headline em {
          font-style: italic;
          color: var(--accent);
        }

        .card-stage {
          display: flex;
          justify-content: center;
          margin: 0 auto 64px;
          opacity: 0;
          animation: card-enter 1.1s cubic-bezier(0.2, 0.85, 0.3, 1) 0.45s forwards;
        }

        @keyframes card-enter {
          0% { opacity: 0; transform: translateY(40px) rotateX(-15deg) scale(0.9); }
          60% { opacity: 1; }
          100% { opacity: 1; transform: translateY(0) rotateX(0deg) scale(1); }
        }

        .message {
          font-family: "Fraunces", Georgia, serif;
          font-style: italic;
          font-size: 19px;
          line-height: 1.6;
          color: var(--ink-soft);
          text-align: center;
          max-width: 480px;
          margin: 0 auto 56px;
          padding: 28px 0;
          border-top: 1px solid var(--hairline);
          border-bottom: 1px solid var(--hairline);
          opacity: 0;
          animation: fade-rise 0.9s ease 0.7s forwards;
        }
        .message .quote-mark {
          font-size: 28px;
          color: var(--accent);
          opacity: 0.7;
          line-height: 0;
          vertical-align: -10px;
          margin: 0 4px;
        }
        .message cite {
          display: block;
          font-style: normal;
          font-family: var(--font-body), sans-serif;
          font-size: 11px;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: var(--ink-fade);
          margin-top: 14px;
        }

        .actions {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 16px;
          margin-bottom: 56px;
          flex-wrap: wrap;
          opacity: 0;
          animation: fade-rise 0.9s ease 0.85s forwards;
        }
        .btn-primary {
          display: inline-block;
          padding: 16px 36px;
          background: var(--ink);
          color: var(--paper);
          font-size: 12px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          font-weight: 500;
          border-radius: 999px;
          text-decoration: none;
          transition: transform 0.3s ease, background 0.3s ease;
        }
        .btn-primary:hover {
          background: var(--accent);
          transform: translateY(-2px);
        }

        .details {
          max-width: 440px;
          margin: 0 auto 64px;
          padding: 0;
          border-top: 1px solid var(--hairline);
          opacity: 0;
          animation: fade-rise 0.9s ease 1s forwards;
        }
        .details > div {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          padding: 16px 0;
          border-bottom: 1px solid var(--hairline);
        }
        .details dt {
          font-size: 11px;
          letter-spacing: 0.24em;
          text-transform: uppercase;
          color: var(--ink-fade);
          margin: 0;
        }
        .details dd {
          margin: 0;
          font-size: 14px;
          color: var(--ink);
        }
        .details .mono {
          font-family: "JetBrains Mono", monospace;
          letter-spacing: 0.12em;
        }

        .page-footer {
          text-align: center;
          padding-top: 32px;
          border-top: 1px solid var(--hairline);
          opacity: 0;
          animation: fade-rise 0.9s ease 1.15s forwards;
        }
        :global(.footer-logo) {
          width: auto !important;
          height: 26px !important;
          opacity: 0.55;
          margin-bottom: 14px;
          display: inline-block;
        }
        .footer-line {
          font-size: 11px;
          color: var(--ink-fade);
          line-height: 1.7;
        }
        .footer-line a {
          color: var(--ink-fade);
          text-decoration: underline;
          text-underline-offset: 2px;
        }

        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes fade-rise {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @media (prefers-reduced-motion: reduce) {
          .voucher-page *, .voucher-page *::before, .voucher-page *::after {
            animation: none !important;
            transition: none !important;
          }
        }
      `,
        }}
      />
    </main>
  );
}
