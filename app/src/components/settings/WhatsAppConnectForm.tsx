"use client";

import { useCallback, useEffect, useState } from "react";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { updateWhatsAppConfig } from "@/app/settings/integrations/whatsapp/actions";

interface ConnectionState {
  configured: boolean;
  connected?: boolean;
  phone?: string | null;
  qr?: string | null;
  error?: string;
}

export function WhatsAppConnectForm({
  initial,
  webhookUrl,
}: {
  initial: { token: string; channel: string; baseUrl: string };
  webhookUrl: string;
}) {
  const [token, setToken] = useState(initial.token);
  const [channel, setChannel] = useState(initial.channel);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [isPending, startTransition] = useTransition();
  const [conn, setConn] = useState<ConnectionState | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/connection", { cache: "no-store" });
      const data = await res.json();
      if (data.ok) setConn(data as ConnectionState);
    } catch {
      /* transient — keep last state */
    }
  }, []);

  // Poll while configured but not yet connected (QR can refresh / link completes).
  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      if (conn?.configured && !conn?.connected) refresh();
    }, 4000);
    return () => clearInterval(id);
  }, [refresh, conn?.configured, conn?.connected]);

  function save() {
    startTransition(async () => {
      const res = await updateWhatsAppConfig({ token, channel, baseUrl });
      if (res.ok) {
        toast.success("WhatsApp settings saved.");
        refresh();
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Card>
        <CardLabel>Connection</CardLabel>
        {!conn || !conn.configured ? (
          <p style={{ color: "var(--text-secondary)", fontSize: 14, margin: 0 }}>
            Add your provider token below, then scan the QR to link a number.
          </p>
        ) : conn.connected ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: "#16a34a",
                display: "inline-block",
              }}
            />
            <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>
              Connected{conn.phone ? ` · ${conn.phone}` : ""}
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
            {conn.qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={conn.qr}
                alt="WhatsApp link QR"
                style={{ width: 180, height: 180, border: "1px solid var(--grid)" }}
              />
            ) : (
              <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>
                {conn.error ? `Provider: ${conn.error}` : "Waiting for QR…"}
              </div>
            )}
            <div style={{ color: "var(--text-secondary)", fontSize: 14, maxWidth: 280 }}>
              On the phone: WhatsApp → <b>Linked devices</b> → <b>Link a device</b>,
              then scan this code. It refreshes automatically.
            </div>
          </div>
        )}
      </Card>

      <Card>
        <CardLabel>Provider credentials</CardLabel>
        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <Label htmlFor="token">API token</Label>
            <Input
              id="token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Whapi channel token"
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <Label htmlFor="channel">Channel ID (optional)</Label>
              <Input id="channel" value={channel} onChange={(e) => setChannel(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="baseUrl">API base URL (optional)</Label>
              <Input
                id="baseUrl"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://gate.whapi.cloud"
              />
            </div>
          </div>
          <div>
            <Button onClick={save} disabled={isPending}>
              {isPending ? "Saving…" : "Save & connect"}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardLabel>Inbound webhook</CardLabel>
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 0 }}>
          To receive replies, set this as the webhook URL in your provider
          dashboard. It only works once the app is hosted at a public URL.
        </p>
        <code
          style={{
            display: "block",
            fontFamily: "var(--font-mono), monospace",
            fontSize: 12,
            background: "var(--surface-2)",
            border: "1px solid var(--grid)",
            borderRadius: "var(--radius)",
            padding: "10px 12px",
            wordBreak: "break-all",
            color: "var(--text-primary)",
          }}
        >
          {webhookUrl}
        </code>
      </Card>

      <div
        style={{
          fontSize: 12,
          color: "var(--text-tertiary)",
          lineHeight: 1.6,
          border: "1px solid var(--grid)",
          borderRadius: "var(--radius)",
          padding: "12px 14px",
        }}
      >
        <strong>Heads up:</strong> this links your number through an unofficial
        WhatsApp bridge — convenient (no templates, message anyone), but it's
        against WhatsApp&rsquo;s Terms and the number can be banned. Use a
        dedicated business/messaging number, not a personal account.
      </div>
    </div>
  );
}
