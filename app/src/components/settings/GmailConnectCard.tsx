"use client";

import { useTransition } from "react";
import { CheckCircle2, HardDrive, Mail, Plug, Unplug } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { disconnectGmailAction } from "@/app/settings/email/gmailActions";

export function GmailConnectCard({
  connectedEmail,
  googleConfigured,
  active,
  driveConnected,
  connectedParam,
  errorParam,
}: {
  connectedEmail: string | null;
  googleConfigured: boolean;
  active: boolean;
  driveConnected: boolean;
  connectedParam: string | null;
  errorParam: string | null;
}) {
  const [pending, start] = useTransition();

  function disconnect() {
    start(async () => {
      const res = await disconnectGmailAction();
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Gmail disconnected");
    });
  }

  return (
    <Card style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Mail size={16} strokeWidth={1.75} />
        <strong style={{ fontSize: 14, color: "var(--text-primary)" }}>
          Connect Google (Gmail + Drive)
        </strong>
        {active && (
          <span
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 12,
              color: "#16a34a",
            }}
          >
            <CheckCircle2 size={13} /> Active sender
          </span>
        )}
      </div>

      {errorParam && (
        <Banner tone="warn">
          Couldn&apos;t connect Gmail: <code>{errorParam}</code>. Please try again.
        </Banner>
      )}
      {connectedParam && !errorParam && (
        <Banner tone="ok">Connected <strong>{connectedParam}</strong>.</Banner>
      )}

      {connectedEmail ? (
        <>
          <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
            Connected as <strong style={{ color: "var(--text-primary)" }}>{connectedEmail}</strong>.
            Invites and client emails send from this address, and replies sync into
            your Communication inbox.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <HardDrive size={14} style={{ color: driveConnected ? "#16a34a" : "var(--text-tertiary)" }} />
            {driveConnected ? (
              <span style={{ color: "var(--text-secondary)" }}>
                Google Drive connected — the assistant can save invoices to your Drive.
              </span>
            ) : (
              <span style={{ color: "var(--text-tertiary)" }}>
                Drive not granted yet — click <strong>Reconnect</strong> and allow Google Drive to enable saving invoices to Drive.
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <a href="/api/google/connect">
              <Button variant="ghost" disabled={pending}>
                <Plug size={14} /> Reconnect
              </Button>
            </a>
            <Button variant="ghost" onClick={disconnect} disabled={pending}>
              <Unplug size={14} /> {pending ? "Disconnecting…" : "Disconnect"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, color: "var(--text-tertiary)", lineHeight: 1.55 }}>
            Send from your business Gmail — no domain or DNS setup. Emails go out
            from your real inbox and replies come back to it and into AdonisAgent.
          </div>
          {googleConfigured ? (
            <a href="/api/google/connect" style={{ alignSelf: "flex-start" }}>
              <Button>
                <Plug size={14} /> Connect Gmail
              </Button>
            </a>
          ) : (
            <Banner tone="warn">
              Gmail sign-in isn&apos;t available yet — the server needs Google OAuth
              credentials (<code>GOOGLE_CLIENT_ID</code> / <code>GOOGLE_CLIENT_SECRET</code>).
            </Banner>
          )}
        </>
      )}
    </Card>
  );
}

function Banner({ tone, children }: { tone: "ok" | "warn"; children: React.ReactNode }) {
  const c =
    tone === "ok"
      ? { bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.3)" }
      : { bg: "rgba(217,119,6,0.08)", border: "rgba(217,119,6,0.3)" };
  return (
    <div
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: "var(--radius)",
        padding: "10px 12px",
        fontSize: 13,
        lineHeight: 1.5,
        color: "var(--text-secondary)",
      }}
    >
      {children}
    </div>
  );
}
