"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Logo } from "@/components/Logo";
import { completeConsoleResetAction, verifyConsoleResetAction } from "./actions";

/**
 * Set a new console password from an emailed link.
 *
 * The token is checked BEFORE the form renders, so a dead link says so
 * instead of taking a password and then refusing it. On success it sends the
 * admin to /login rather than signing them in: `completeUserReset` revokes
 * every existing session, which is the point of a reset.
 */
export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = searchParams.token ?? "";
  const [state, setState] = useState<
    { phase: "checking" } | { phase: "bad"; reason: string } | { phase: "ready"; email: string } | { phase: "done" }
  >({ phase: "checking" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setState({ phase: "bad", reason: "invalid" });
      return;
    }
    let live = true;
    void verifyConsoleResetAction(token).then((res) => {
      if (!live) return;
      setState(res.ok ? { phase: "ready", email: res.email } : { phase: "bad", reason: res.reason });
    });
    return () => {
      live = false;
    };
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Those two passwords do not match.");
      return;
    }
    setBusy(true);
    const res = await completeConsoleResetAction(token, password);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setState({ phase: "done" });
  }

  const title =
    state.phase === "done"
      ? "Password changed"
      : state.phase === "bad"
        ? "That link has expired"
        : "Set a new password";
  const lede =
    state.phase === "done"
      ? "Sign in with your new password."
      : state.phase === "bad"
        ? "Reset links last two hours and work once. Ask for a fresh one and it will be with you in a moment."
        : state.phase === "ready"
          ? `For ${state.email}.`
          : "Checking your link…";

  return (
    <main className="signin">
      <div className="signin-wash" aria-hidden />

      <header className="signin-mark">
        <Logo size={20} />
      </header>

      <div className="signin-body">
        <section className="signin-form">
          <h1>{title}</h1>
          <p className="signin-sub">{lede}</p>

          {state.phase === "ready" ? (
            <form onSubmit={onSubmit} noValidate>
              <input
                className="field"
                type="password"
                autoComplete="new-password"
                placeholder="New password"
                aria-label="New password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <input
                className="field"
                type="password"
                autoComplete="new-password"
                placeholder="Confirm new password"
                aria-label="Confirm new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
              {error ? (
                <p className="signin-error" role="alert">
                  {error}
                </p>
              ) : null}
              <button className="signin-go" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save password"}
              </button>
            </form>
          ) : null}

          <a className="signin-forgot" href={state.phase === "bad" ? "/forgot-password" : "/login"}>
            {state.phase === "bad" ? "Send me a new link" : "Back to sign in"}
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
