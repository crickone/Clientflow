"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";

export function ClientLoginForm({ logoSrc, businessName }: { logoSrc: string | null; businessName: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      <div style={{ textAlign: "center", fontSize: 12, color: "var(--text-tertiary)" }}>
        Trouble signing in? Contact your coach.
      </div>
    </div>
  );
}
