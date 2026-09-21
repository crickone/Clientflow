"use client";

import { useState, type FormEvent } from "react";

import { Logo } from "@/components/Logo";

/**
 * Console sign-in.
 *
 * Structured like a modern consumer sign-in (Revolut's is the reference the
 * brief named): the page itself is the surface — wordmark pinned top-left, one
 * column of content held left of centre, a quiet legal line at the foot — with
 * no card boxing the form in. A boxed form floating in the middle of an empty
 * page reads as an afterthought; this reads as a front door.
 *
 * The right-hand half carries the marketing site's metal sculpture rather than
 * a QR code (there is no phone app to scan with). It is the same SVG as
 * sites/adonisagent, so the console and the website open with the same object.
 * Decorative, aria-hidden, and it degrades to nothing on a narrow screen.
 */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Sign-in failed");
        setBusy(false);
        return;
      }
      window.location.href = "/";
    } catch {
      setError("Network error — please try again.");
      setBusy(false);
    }
  }

  return (
    <main className="signin">
      <div className="signin-wash" aria-hidden />

      <header className="signin-mark">
        <Logo size={20} />
      </header>

      <div className="signin-body">
        <section className="signin-form">
          <h1>Welcome back</h1>
          <p className="signin-sub">Sign in to the AdonisAgent platform console.</p>

          <form onSubmit={onSubmit} noValidate>
            <input
              className="field"
              type="email"
              autoComplete="username"
              placeholder="Email address"
              aria-label="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              className="field"
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              aria-label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            {error ? (
              <p className="signin-error" role="alert">
                {error}
              </p>
            ) : null}

            <button className="signin-go" type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Continue"}
            </button>
          </form>

          <p className="signin-note">
            Platform admins only. Business owners sign in at{" "}
            <a href="https://app.adonisagent.ie">app.adonisagent.ie</a>.
          </p>
        </section>

        <aside className="signin-art" aria-hidden>
          <svg viewBox="0 0 420 420">
            <defs>
              <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#f1f7ff" />
                <stop offset=".19" stopColor="#8193a9" />
                <stop offset=".36" stopColor="#e4ebf6" />
                <stop offset=".48" stopColor="#47596a" />
                <stop offset=".69" stopColor="#a9bbcf" />
                <stop offset=".85" stopColor="#34404f" />
                <stop offset="1" stopColor="#d7e9fa" />
              </linearGradient>
              <linearGradient id="edge" x1="0" y1="1" x2="1" y2="0">
                <stop stopColor="#111821" />
                <stop offset=".5" stopColor="#607286" />
                <stop offset="1" stopColor="#151e29" />
              </linearGradient>
              <filter id="metal-shadow" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="4" dy="25" stdDeviation="15" floodColor="#000" floodOpacity=".7" />
              </filter>
            </defs>
            <g filter="url(#metal-shadow)">
              <path className="sculpt-depth" d="M70 70H350V350H70V140H280V280H140V210H210" />
              <path className="sculpt-face" d="M70 70H350V350H70V140H280V280H140V210H210" />
              <path className="sculpt-edge" d="M70 70H350V350H70V140H280V280H140V210H210" />
            </g>
          </svg>
        </aside>
      </div>

      <footer className="signin-foot">
        <span>AdonisAgent Platform</span>
        <a href="https://www.adonisagent.ie/">adonisagent.ie</a>
      </footer>
    </main>
  );
}
