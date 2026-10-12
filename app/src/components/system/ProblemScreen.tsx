import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The one layout for "something is not where you expected": the crash screen
 * (app/error.tsx), page-not-found (app/not-found.tsx) and anything like them.
 * Server-safe (no hooks) so not-found can render it; the crash screen passes
 * its client-side Try again button in as `primary`.
 */
export function ProblemScreen({
  code,
  title,
  body,
  icon,
  primary,
  reference,
}: {
  code: string;
  title: string;
  body: string;
  icon: ReactNode;
  primary?: ReactNode;
  reference?: string | null;
}) {
  return (
    <main className="problem">
      <div className="problem-card">
        <span className="problem-icon" aria-hidden>
          {icon}
        </span>
        <p className="problem-code">{code}</p>
        <h1 className="problem-title">{title}</h1>
        <p className="problem-body">{body}</p>
        <div className="problem-actions">
          {primary}
          <Link href="/dashboard" className="btn btn--secondary btn--md">
            Go to the dashboard
          </Link>
        </div>
        <nav className="problem-links" aria-label="Main areas">
          <Link href="/clients">Clients</Link>
          <Link href="/communication">Inbox</Link>
          <Link href="/content-studio">Content Studio</Link>
          <Link href="/settings">Settings</Link>
        </nav>
        {reference ? (
          <p className="problem-ref">
            Reference <code>{reference}</code>. Quote it if you get in touch.
          </p>
        ) : null}
      </div>
    </main>
  );
}
