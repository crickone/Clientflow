import type { ReactNode } from "react";

import { Logo } from "@/components/ui/Logo";
import { SignOutLink } from "./SignOutLink";

/**
 * The frame every signed-out page shares: sign in, forgot password, reset
 * password.
 *
 * The page is the surface — lockup pinned top-left, one column of content held
 * left of centre, a quiet line at the foot — matching the platform console's
 * sign-in. They were three small centred cards, each with their own inline
 * styles and their own idea of spacing, which is how the three drifted apart
 * in the first place.
 *
 * `logoSrc` carries a tenant's own logo when the host resolves to one (the
 * co-branded sign-in); otherwise <Logo> falls back to the AdonisAgent lockup.
 */
export function AuthLayout({
  title,
  lede,
  logoSrc = null,
  businessName = "",
  children,
  footer,
  signedInAs,
}: {
  title: string;
  lede?: string;
  logoSrc?: string | null;
  businessName?: string;
  children: ReactNode;
  /** Below the form: a "back to sign in" link, a forgot-password link. */
  footer?: ReactNode;
  /**
   * The email of an already-signed-in operator, when there is one.
   *
   * These pages are reachable with a live session — you can want a new
   * password while signed in — and staying silent about it is how "Back to
   * sign in" lands you on the dashboard with no explanation: /login redirects
   * a signed-in user straight there. Saying so, and offering the way out,
   * costs one line.
   */
  signedInAs?: string | null;
}) {
  return (
    <main className="auth">
      <div className="auth-wash" aria-hidden />

      <header className="auth-mark">
        <Logo src={logoSrc} alt={businessName} height={20} />
      </header>

      <div className="auth-body">
        <section className="auth-col">
          <h1>{title}</h1>
          {lede ? <p className="auth-lede">{lede}</p> : null}
          {children}
          {footer ? <div className="auth-footer-links">{footer}</div> : null}
          {signedInAs ? (
            <p className="auth-session">
              You are signed in as <strong>{signedInAs}</strong>.{" "}
              <a href="/dashboard">Go to your dashboard</a> or <SignOutLink />.
            </p>
          ) : null}
        </section>
      </div>

      <footer className="auth-foot">
        <span>AdonisAgent</span>
        <a href="https://www.adonisagent.ie/">adonisagent.ie</a>
      </footer>
    </main>
  );
}
