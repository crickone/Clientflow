"use client";

import { useState, type FormEvent } from "react";

import { Logo } from "@/components/Logo";

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

  const labelSpan = {
    display: "block",
    marginBottom: 7,
    fontFamily: "var(--font-mono), ui-monospace, monospace",
    fontSize: 10,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    color: "var(--text-tertiary)",
  };

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ width: 380, maxWidth: "100%" }}>
        {/* Wordmark */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 26 }}>
          <Logo size={30} />
        </div>

        <form onSubmit={onSubmit} className="glass" style={{ padding: 28 }}>
          <h1 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>
            Sign in
          </h1>
          <p
            style={{
              margin: "0 0 24px",
              fontFamily: "var(--font-mono), ui-monospace, monospace",
              fontSize: 10.5,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
            }}
          >
            Platform admins only
          </p>

          <label style={{ display: "block", marginBottom: 16 }}>
            <span style={labelSpan}>Email</span>
            <input
              className="input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label style={{ display: "block", marginBottom: 20 }}>
            <span style={labelSpan}>Password</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error ? (
            <p style={{ margin: "0 0 14px", color: "var(--red)", fontSize: 13 }}>{error}</p>
          ) : null}

          <button
            className="btn btn--primary btn--lg"
            type="submit"
            disabled={busy}
            style={{ width: "100%" }}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
