"use client";

import { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Logo } from "@/components/ui/Logo";
import { requestPasswordResetAction } from "./actions";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await requestPasswordResetAction(email);
    } finally {
      // Always show the same confirmation — never reveal whether the email
      // exists (enumeration-safe, mirroring the request action itself).
      setSent(true);
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
          <Logo src={null} alt="" height={28} />
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
          Forgot password
        </h1>
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: 13,
            textAlign: "center",
            marginBottom: 26,
          }}
        >
          We&apos;ll email you a link to reset it.
        </p>

        {sent ? (
          <div
            style={{
              background: "var(--accent-soft)",
              border: "1px solid rgba(255, 106, 50, 0.3)",
              color: "var(--accent-ink)",
              fontSize: 13,
              padding: "10px 12px",
              borderRadius: "var(--radius)",
              lineHeight: 1.5,
            }}
          >
            If an account exists for <strong>{email}</strong>, we&apos;ve sent a link to reset your password. Check
            your inbox (and spam).
          </div>
        ) : (
          <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <Label htmlFor="email" srOnly>Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                autoFocus
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
              />
            </div>
            <Button type="submit" disabled={busy} style={{ marginTop: 6 }}>
              {busy ? "Sending…" : "Email me a reset link"}
            </Button>
          </form>
        )}

        <div style={{ textAlign: "center", marginTop: 20 }}>
          <Link href="/login" style={{ color: "var(--text-tertiary)", fontSize: 13, textDecoration: "none" }}>
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
