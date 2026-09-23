"use client";

import { useState } from "react";
import Link from "next/link";

import { AuthLayout } from "@/components/auth/AuthLayout";

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
    <AuthLayout
      title={sent ? "Check your inbox" : "Reset your password"}
      lede={
        sent
          ? undefined
          : "Give us the email you sign in with and we'll send you a link to set a new password."
      }
      footer={<Link href="/login">Back to sign in</Link>}
    >
      {sent ? (
        <div className="auth-sent">
          If an account exists for <strong>{email}</strong>, the link is on its way. It expires in an hour, and
          it only works once. Worth checking your spam folder if it has not arrived in a few minutes.
        </div>
      ) : (
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
          <button className="auth-go" type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send the link"}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
