"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { requestClientResetAction } from "@/app/app/reset/actions";

export function ClientLoginForm({ logoSrc, businessName }: { logoSrc: string | null; businessName: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"signin" | "forgot">("signin");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  const submitForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotBusy(true);
    try {
      await requestClientResetAction(forgotEmail);
    } finally {
      // Always show the same confirmation — never reveal whether the email exists.
      setForgotSent(true);
      setForgotBusy(false);
    }
  };

  if (mode === "forgot") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 24px", gap: 26 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <Logo src={logoSrc} alt={businessName} height={34} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: 22, textTransform: "uppercase", color: "var(--text-primary)" }}>Reset password</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>We&apos;ll email you a link to set a new one</div>
          </div>
        </div>

        {forgotSent ? (
          <div style={{ textAlign: "center", fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.6, maxWidth: 340, margin: "0 auto" }}>
            If an account exists for <strong>{forgotEmail}</strong>, we&apos;ve sent a link to reset your password. Check your inbox (and spam).
          </div>
        ) : (
          <form onSubmit={submitForgot} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <Label htmlFor="fp-email">Email</Label>
              <Input id="fp-email" type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} placeholder="you@email.com" autoComplete="email" autoFocus />
            </div>
            <Button type="submit" disabled={forgotBusy} style={{ justifyContent: "center", height: 46, marginTop: 4 }}>
              {forgotBusy ? <Loader2 size={16} className="spin" /> : "Email me a reset link"}
            </Button>
          </form>
        )}

        <div style={{ textAlign: "center" }}>
          <button type="button" onClick={() => { setMode("signin"); setForgotSent(false); }} style={{ background: "none", border: "none", color: "var(--text-tertiary)", fontSize: 13, cursor: "pointer" }}>
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/client-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Login failed.");
      router.push("/app");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 24px", gap: 26 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <Logo src={logoSrc} alt={businessName} height={34} />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: 22, textTransform: "uppercase", color: "var(--text-primary)" }}>Welcome back</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>Sign in to your {businessName} app</div>
        </div>
      </div>

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <Label htmlFor="cl-email">Email</Label>
          <Input id="cl-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" autoComplete="email" autoFocus />
        </div>
        <div>
          <Label htmlFor="cl-pass">Password</Label>
          <Input id="cl-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
        </div>
        {error && <div style={{ color: "#f87171", fontSize: 13 }}>{error}</div>}
        <Button type="submit" disabled={busy} style={{ justifyContent: "center", height: 46, marginTop: 4 }}>
          {busy ? <Loader2 size={16} className="spin" /> : "Sign in"}
        </Button>
      </form>

      <div style={{ textAlign: "center", fontSize: 13 }}>
        <button type="button" onClick={() => { setMode("forgot"); setForgotEmail(email); }} style={{ background: "none", border: "none", color: "var(--text-secondary)", fontSize: 13, cursor: "pointer" }}>
          Forgot password?
        </button>
      </div>
    </div>
  );
}
