"use client";

import { useState, type FormEvent } from "react";

import { Logo } from "@/components/Logo";
import { requestConsoleResetAction } from "./actions";

/**
 * Console password reset — the console's OWN page.
 *
 * It used to link to the CRM's flow at app.adonisagent.ie, which sent a
 * platform admin to a customer product to recover an admin password and
 * dropped them in a tenant workspace afterwards. The token is the same
 * control-plane one; only the journey is the console's.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await requestConsoleResetAction(email);
    setBusy(false);
    setSent(true);
  }

  return (
    <main className="signin">
      <div className="signin-wash" aria-hidden />

      <header className="signin-mark">
        <Logo size={20} />
      </header>

      <div className="signin-body">
        <section className="signin-form">
          <h1>Reset your password</h1>
          <p className="signin-sub">Give us the email you sign in with and we&apos;ll send a link to set a new one.</p>

          {sent ? (
            <p className="signin-sent">
              If an account exists for <strong>{email}</strong>, the link is on its way. It expires in two hours
              and works once. Check your spam folder if it has not arrived in a few minutes.
            </p>
          ) : (
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
            <button className="signin-go" type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send the link"}
            </button>
          </form>
          )}

          <a className="signin-forgot" href="/login">
            Back to sign in
          </a>
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
