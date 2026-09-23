"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";

import { AuthLayout } from "@/components/auth/AuthLayout";


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
    <AuthLayout
      title="Welcome back"
      lede={businessName ? `Sign in to ${businessName}.` : "Sign in to your workspace."}
      logoSrc={logoSrc}
      businessName={businessName}
      footer={<Link href="/forgot-password">Forgot your password?</Link>}
    >
      {notice ? <p className="auth-notice">{notice}</p> : null}

      <form onSubmit={onSubmit}>
        <input
          className="auth-field"
          id="email"
          type="email"
          autoComplete="email"
          aria-label="Email address"
          required
          autoFocus
          placeholder="Email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
        />
        <input
          className="auth-field"
          id="password"
          type="password"
          autoComplete="current-password"
          aria-label="Password"
          required
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />

        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}

        <button className="auth-go" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Continue"}
        </button>
      </form>
    </AuthLayout>
  );
}
