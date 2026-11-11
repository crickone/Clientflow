"use client";

import { useEffect, useState, type FormEvent, use } from "react";

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
export default function ResetPasswordPage(
  props: {
    searchParams: Promise<{ token?: string }>;
  }
) {
  const searchParams = use(props.searchParams);
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
      </div>

      <footer className="signin-foot">
        <span>AdonisAgent Platform</span>
        <a href="https://www.adonisagent.ie/">adonisagent.ie</a>
      </footer>
    </main>
  );
}
