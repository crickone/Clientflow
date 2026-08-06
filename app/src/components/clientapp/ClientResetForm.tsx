"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { completeClientResetAction } from "@/app/app/reset/actions";

const shell: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  padding: "0 24px",
  gap: 26,
};

/** Set-a-new-password form, reached from a reset or invite link. */
export function ClientResetForm({
  logoSrc,
  businessName,
  token,
  email,
}: {
  logoSrc: string | null;
  businessName: string;
  token: string;
  email: string;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) return setError("Password must be at least 6 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    try {
      const res = await completeClientResetAction(token, password);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success("Password set — you can sign in now.");
      router.replace("/app/login");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={shell}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <Logo src={logoSrc} alt={businessName} height={34} />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: 22, textTransform: "uppercase", color: "var(--text-primary)" }}>
            Set your password
          </div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
            for <strong>{email}</strong>
          </div>
        </div>
      </div>

      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <Label htmlFor="rs-pass">New password</Label>
          <Input
            id="rs-pass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            autoComplete="new-password"
            autoFocus
          />
        </div>
        <div>
          <Label htmlFor="rs-confirm">Confirm password</Label>
          <Input
            id="rs-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        {error && <div style={{ color: "#f87171", fontSize: 13 }}>{error}</div>}
        <Button type="submit" disabled={busy} style={{ justifyContent: "center", height: 46, marginTop: 4 }}>
          {busy ? <Loader2 size={16} className="spin" /> : "Save password"}
        </Button>
      </form>
    </div>
  );
}

/** A simple message card for invalid / expired / used reset links. */
export function ClientResetMessage({
  logoSrc,
  businessName,
  title,
  body,
}: {
  logoSrc: string | null;
  businessName: string;
  title: string;
  body: string;
}) {
  return (
    <div style={shell}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <Logo src={logoSrc} alt={businessName} height={34} />
        <div style={{ textAlign: "center", maxWidth: 340 }}>
          <div style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: 22, textTransform: "uppercase", color: "var(--text-primary)" }}>
            {title}
          </div>
          <div style={{ fontSize: 13.5, color: "var(--text-secondary)", marginTop: 8, lineHeight: 1.6 }}>{body}</div>
        </div>
      </div>
      <div style={{ textAlign: "center" }}>
        <Link href="/app/login" style={{ color: "var(--accent-ink, var(--accent))", fontSize: 13, textDecoration: "none" }}>
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
