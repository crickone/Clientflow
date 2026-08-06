"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Logo } from "@/components/ui/Logo";
import { acceptInviteAction } from "@/app/accept-invite/actions";

export function AcceptInviteForm({
  logoSrc,
  businessName,
  token,
  email,
  initialName,
  tenantName,
}: {
  logoSrc: string | null;
  businessName: string;
  token: string;
  email: string;
  initialName: string;
  tenantName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    start(async () => {
      const res = await acceptInviteAction(token, { name, password });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success("You're all set — sign in to continue.");
      router.replace("/login");
    });
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
          maxWidth: 400,
          background: "var(--surface-1)",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius)",
          padding: "36px 32px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
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
            marginBottom: 6,
          }}
        >
          Join {tenantName}
        </h1>
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: 13,
            textAlign: "center",
            marginBottom: 24,
          }}
        >
          Set your password to activate <strong>{email}</strong>.
        </p>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <Label htmlFor="inv-name">Your name</Label>
            <Input
              id="inv-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
              disabled={pending}
              autoFocus={!initialName}
            />
          </div>
          <div>
            <Label htmlFor="inv-pw">Password</Label>
            <Input
              id="inv-pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="At least 8 characters"
              required
              disabled={pending}
            />
          </div>
          <div>
            <Label htmlFor="inv-confirm">Confirm password</Label>
            <Input
              id="inv-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
              disabled={pending}
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

          <Button type="submit" disabled={pending} style={{ marginTop: 6 }}>
            {pending ? "Setting up…" : "Set password & continue"}
          </Button>
        </form>
      </div>
    </div>
  );
}
