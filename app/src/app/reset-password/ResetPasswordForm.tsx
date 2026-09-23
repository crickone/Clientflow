"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { AuthLayout } from "@/components/auth/AuthLayout";

import { completePasswordResetAction } from "./actions";

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
    <AuthLayout title="Set a new password" lede={`For ${email}.`}>
      <form onSubmit={onSubmit}>
        <input
          className="auth-field"
          id="rp-pass"
          type="password"
          autoComplete="new-password"
          aria-label="New password"
          required
          autoFocus
          placeholder="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />
        <input
          className="auth-field"
          id="rp-confirm"
          type="password"
          autoComplete="new-password"
          aria-label="Confirm new password"
          required
          placeholder="Confirm new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={busy}
        />

        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}

        <button className="auth-go" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save and sign in"}
        </button>
      </form>
    </AuthLayout>
  );
}

/** Invalid, expired, already-used or missing reset links all land here. */
export function ResetPasswordMessage({ title, body }: { title: string; body: string }) {
  return (
    <AuthLayout
      title={title}
      lede={body}
      footer={<Link href="/forgot-password">Request a new link</Link>}
    >
      {null}
    </AuthLayout>
  );
}
