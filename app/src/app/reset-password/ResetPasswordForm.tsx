"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Logo } from "@/components/ui/Logo";
import { completePasswordResetAction } from "./actions";

const shell: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  background: "var(--bg)",
};

const card: React.CSSProperties = {
  width: "100%",
  maxWidth: 380,
  background: "var(--surface-1)",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
  padding: "36px 32px",
};

const heading: React.CSSProperties = {
  fontFamily: "var(--font-heading), sans-serif",
  fontSize: 22,
  fontWeight: 400,
  color: "var(--text-primary)",
  textAlign: "center",
  textTransform: "uppercase",
  letterSpacing: "-0.005em",
  marginBottom: 6,
};

/** Set-a-new-password form, reached from a valid reset link. */
export function ResetPasswordForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    try {
      const res = await completePasswordResetAction(token, password);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.replace("/login?reset=1");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={shell}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
          <Logo src={null} alt="" height={28} />
        </div>
        <h1 style={heading}>Set a new password</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 13, textAlign: "center", marginBottom: 26 }}>
          for <strong>{email}</strong>
        </p>

        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <Label htmlFor="rp-pass">New password</Label>
            <Input
              id="rp-pass"
              type="password"
              autoComplete="new-password"
              required
              autoFocus
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </div>
          <div>
            <Label htmlFor="rp-confirm">Confirm password</Label>
            <Input
              id="rp-confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
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
            {busy ? "Saving…" : "Save password"}
          </Button>
        </form>
      </div>
    </div>
  );
}

/** A simple message card for invalid / expired / used / missing reset links. */
export function ResetPasswordMessage({ title, body }: { title: string; body: string }) {
  return (
    <div style={shell}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
          <Logo src={null} alt="" height={28} />
        </div>
        <h1 style={heading}>{title}</h1>
        <p style={{ fontSize: 13.5, color: "var(--text-secondary)", textAlign: "center", lineHeight: 1.6, marginBottom: 26 }}>
          {body}
        </p>
        <div style={{ textAlign: "center" }}>
          <Link href="/forgot-password" style={{ color: "var(--accent-ink, var(--accent))", fontSize: 13, textDecoration: "none" }}>
            Request a new link
          </Link>
        </div>
      </div>
    </div>
  );
}
