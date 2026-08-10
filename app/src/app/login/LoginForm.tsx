"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Logo } from "@/components/ui/Logo";

export function LoginForm({
  logoSrc,
  businessName,
  notice,
}: {
  logoSrc: string | null;
  businessName: string;
  /** A non-error, informational banner (e.g. an expired one-time link). */
  notice?: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Sign-in failed");
        setBusy(false);
        return;
      }
      router.replace(
        data.redirect ??
          (data.mustChangePassword ? "/change-password" : "/dashboard"),
      );
      router.refresh();
    } catch (err) {
      setError("Network error");
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--bg)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          background: "var(--surface-1)",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius)",
          padding: "36px 32px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
          <Logo src={logoSrc} alt={businessName} height={28} />
        </div>
        <h1
          style={{
            fontFamily: "var(--font-heading), sans-serif",
            fontSize: 22,
            fontWeight: 400,
            color: "var(--text-primary)",
            textAlign: "center",
            textTransform: "uppercase",
            letterSpacing: "-0.005em",
            marginBottom: 6,
          }}
        >
          Sign in
        </h1>
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: 13,
            textAlign: "center",
            marginBottom: 26,
          }}
        >
          Access your dashboard.
        </p>

        {notice && (
          <div
            style={{
              background: "var(--accent-soft)",
              border: "1px solid rgba(255, 106, 50, 0.3)",
              color: "var(--accent-ink)",
              fontSize: 13,
              padding: "8px 12px",
              borderRadius: "var(--radius)",
              marginBottom: 14,
            }}
          >
            {notice}
          </div>
        )}

        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </div>

          {error && (
            <div
              style={{
                background: "rgba(220, 38, 38, 0.08)",
                border: "1px solid rgba(220, 38, 38, 0.3)",
                color: "#dc2626",
                fontSize: 13,
                padding: "8px 12px",
                borderRadius: "var(--radius)",
              }}
            >
              {error}
            </div>
          )}

          <Button type="submit" disabled={busy} style={{ marginTop: 6 }}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
