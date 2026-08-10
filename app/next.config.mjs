/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle for the Docker runtime image
  // (.next/standalone). Native deps (better-sqlite3, ffmpeg-static) stay
  // external — see serverComponentsExternalPackages below.
  output: "standalone",
  images: { unoptimized: true },
  async headers() {
    // Conservative, high-value headers applied everywhere. SAMEORIGIN (not DENY)
    // keeps our own iframes working (client-app preview, Studio preview);
    // nosniff stops MIME-confusion on served uploads.
    //
    // CSP (Batch 2b): a DELIBERATELY PARTIAL policy — only the directives that
    // are safe for BOTH the admin app (3k+ inline styles, Next's inline
    // bootstrap scripts, Framer Motion) AND the public CMS sites (first-party
    // GSAP/Lenis). object-src 'none' kills flash/embed XSS; base-uri 'self'
    // blocks <base> injection; frame-ancestors 'self' is the modern clickjacking
    // guard (mirrors X-Frame-Options). We intentionally do NOT set script-src /
    // style-src here: a real script-src CSP needs nonce-based inline handling
    // (would otherwise break Next's inline scripts + the inline styles + GSAP) —
    // that's a separate, larger follow-up gated on reducing inline usage (F5).
    const csp = "object-src 'none'; base-uri 'self'; frame-ancestors 'self'";
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          // HSTS: force HTTPS for 1y incl. subdomains (app + custom client
          // domains are HTTPS-only on Railway). No `preload` — that's a registry
          // commitment we don't want to make implicitly.
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
  // Types are validated locally (tsc --noEmit + a full `next build`) before every
  // deploy. Skip the in-Docker type-check, which is redundant and has flaked
  // (OOM on Railway's builder) — keeping production builds reliable.
  typescript: { ignoreBuildErrors: true },
  // ESLint (Batch 7a, improvement-plan-2026-08.md Theme G1): app/.eslintrc.json
  // was added as a REPORTING gate — `npm run lint` / CI's non-blocking Lint
  // step — against an unaddressed pre-existing backlog (17 errors/6 warnings
  // at the time this was added). Next's build step runs its own internal
  // ESLint pass and FAILS the build on any error-level rule by default; without
  // this flag, simply adding a valid config would turn `next build` (and every
  // deploy) red overnight. Same rationale/pattern as `typescript.ignoreBuildErrors`
  // above — the real gate is the separate `next lint` step, not the build.
  // Revisit once the backlog is cleared (see the Lint step's comment in
  // .github/workflows/ci.yml).
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // Batch 1 fix wave (review finding #1, CRITICAL): on Next 14, `register()`
    // in src/instrumentation.ts is ONLY invoked — and the file is only emitted
    // into the standalone build at all — when this flag is set. Without it the
    // process-level crash guards (unhandledRejection/uncaughtException) never
    // install in production; they'd silently be dead code on Railway. Stable
    // (no flag needed) from Next 15 onward — remove this once upgraded past 14.
    instrumentationHook: true,
    // better-sqlite3/sharp ship native bindings — keep them server-only.
    // sharp (Batch 5c, improvement-plan-2026-08.md Theme F4): downscales +
    // re-encodes uploaded raster images. Never import it from a client
    // component — see src/lib/image/processUpload.ts.
    // imapflow/nodemailer/mailparser (IMAP email connector): pure-JS but use
    // dynamic require()s that webpack can bundle at build time yet break at
    // runtime — keep them external so output-file-tracing copies the real
    // packages into .next/standalone/node_modules (see src/lib/imapEmail.ts).
    serverComponentsExternalPackages: [
      "better-sqlite3",
      "ffmpeg-static",
      "ffprobe-static",
      "sharp",
      "imapflow",
      "nodemailer",
      "mailparser",
    ],
  },
};

export default nextConfig;
