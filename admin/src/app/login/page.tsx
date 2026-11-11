"use client";

import { useState, type FormEvent } from "react";

import { Logo } from "@/components/Logo";

/**
 * Console sign-in.
 *
 * The page is the surface: wordmark pinned top-left, one centred column for
 * the form, a quiet line at the foot. No card and no artwork, so the form is
 * the only thing on the screen. forgot-password and reset-password share the
 * same layout (the .signin classes in globals.css).
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

          <a className="signin-forgot" href="/forgot-password">
            Forgot your password?
          </a>

          <p className="signin-note">
            Platform admins only. Business owners sign in at{" "}
            <a href="https://app.adonisagent.ie">app.adonisagent.ie</a>.
          </p>
        </section>
      </div>

      <footer className="signin-foot">
        <span>AdonisAgent Platform</span>
        <a href="https://www.adonisagent.ie/">adonisagent.ie</a>
      </footer>
    </main>
  );
}
