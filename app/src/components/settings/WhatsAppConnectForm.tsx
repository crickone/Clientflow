"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Check, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { moveWhatsAppSecretToHeader, updateWhatsAppConfig } from "@/app/settings/integrations/whatsapp/actions";

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
  headerMode = false,
  canMoveSecret = false,
}: {
  initial: { token: string; channel: string; baseUrl: string };
  webhookUrl: string;
  /** The webhook secret travels as a header (Settings action moveWhatsAppSecretToHeader). */
  headerMode?: boolean;
  canMoveSecret?: boolean;
}) {
  const [token, setToken] = useState(initial.token);
  const [channel, setChannel] = useState(initial.channel);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [isPending, startTransition] = useTransition();
  const [conn, setConn] = useState<ConnectionState | null>(null);
  const [moving, startMove] = useTransition();
  function moveSecret() {
    startMove(async () => {
      const res = await moveWhatsAppSecretToHeader();
      if (!res.ok) return void toast.error(res.error);
      toast.success(headerMode ? "Replies set up again." : "Replies set up. Send a test message to check.");
      window.location.reload();
    });
  }

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
      try {
        const res = await updateWhatsAppConfig({ token, channel, baseUrl });
        if (res.ok) {
          toast.success("WhatsApp settings saved.");
          refresh();
        } else {
          toast.error("Couldn't save — please try again.");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't save — please try again.");
      }
    });
  }

  const tokenSaved = Boolean(initial.token) || Boolean(conn?.configured);
  const linked = Boolean(conn?.connected);
  const steps: { done: boolean; body: ReactNode }[] = [
    {
      done: tokenSaved,
      body: (
        <>
          Create an account at{" "}
          <a href="https://whapi.cloud" target="_blank" rel="noreferrer" style={{ color: "var(--text-primary)", textDecoration: "underline", display: "inline-flex", alignItems: "center", gap: 3 }}>
            whapi.cloud<ExternalLink size={12} aria-hidden />
          </a>{" "}
          and add a channel. Use a paid plan: the free one stops at 150 messages a day.
        </>
      ),
    },
    {
      done: tokenSaved,
      body: (
        <>
          Open the channel in Whapi, copy its <b>API token</b>, paste it under Provider credentials below and press <b>Save &amp; connect</b>. Leave
          Channel ID and API base URL empty.
        </>
      ),
    },
    {
      done: linked,
      body: (
        <>
          A QR code appears under Connection. On the business phone open WhatsApp, go to <b>Settings</b>, <b>Linked devices</b>, <b>Link a
          device</b>, and scan it.
        </>
      ),
    },
    {
      done: headerMode,
      body: (
        <>
          Under Replies, press <b>Set up replies</b> so messages people send you show up in the Inbox.
        </>
      ),
    },
    {
      done: false,
      body: <>Send a message to the number from another phone. It should appear in the Inbox within a few seconds; reply from there to check it arrives.</>,
    },
  ];
  const current = steps.findIndex((st) => !st.done);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Card>
        <CardLabel>How to connect</CardLabel>
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 14 }}>
          {steps.map((st, i) => {
            const isNow = i === current;
            return (
              <li key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span
                  aria-hidden
                  style={{
                    flex: "none",
                    width: 24,
                    height: 24,
                    borderRadius: 999,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 600,
                    background: st.done ? "var(--accent)" : "transparent",
                    color: st.done ? "var(--accent-contrast)" : isNow ? "var(--text-primary)" : "var(--text-tertiary)",
                    border: st.done ? "1.5px solid var(--accent)" : `1.5px solid ${isNow ? "var(--text-primary)" : "var(--hairline-strong)"}`,
                  }}
                >
                  {st.done ? <Check size={13} strokeWidth={3} /> : i + 1}
                </span>
                <span
                  style={{
                    fontSize: 14,
                    lineHeight: 1.55,
                    paddingTop: 2,
                    color: st.done ? "var(--text-tertiary)" : isNow ? "var(--text-primary)" : "var(--text-secondary)",
                  }}
                >
                  <span className="sr-only">{st.done ? "Done: " : isNow ? "Next: " : ""}</span>
                  {st.body}
                </span>
              </li>
            );
          })}
        </ol>
      </Card>

      <Card>
        <CardLabel>Connection</CardLabel>
        {!conn || !conn.configured ? (
          <p style={{ color: "var(--text-secondary)", fontSize: 14, margin: 0 }}>
            Not connected yet. Save your Whapi token below and a QR code to scan appears here.
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
              On the business phone: WhatsApp, <b>Settings</b>, <b>Linked devices</b>, <b>Link a device</b>,
              then scan this code. It refreshes by itself.
            </div>
          </div>
        )}
      </Card>

      <Card>
        <CardLabel>Provider credentials</CardLabel>
        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <Label htmlFor="token" srOnly>API token</Label>
            <Input
              id="token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="API token"
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <Label htmlFor="channel" srOnly>Channel ID (optional)</Label>
              <Input id="channel" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="Channel ID (optional)" />
            </div>
            <div>
              <Label htmlFor="baseUrl" srOnly>API base URL (optional)</Label>
              <Input
                id="baseUrl"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="API base URL (optional)"
              />
            </div>
          </div>
          <div>
            <Button onClick={save} loading={isPending}>
              {isPending ? "Saving…" : "Save & connect"}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardLabel>Replies</CardLabel>
        <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 0 }}>
          {headerMode
            ? "Replies are set up: Whapi sends every message people send you to this address, and they show up in the Inbox."
            : canMoveSecret
              ? "Press Set up replies so Whapi sends messages people send you to the Inbox. This is the address it will use:"
              : "Save your Whapi token first. Then a Set up replies button appears here. This is the address Whapi will send replies to:"}
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
        {headerMode ? (
          <p style={{ color: "var(--text-secondary)", fontSize: 13, margin: "10px 0 0" }}>
            If you change the webhook in the Whapi dashboard, press the button below to set it back.
          </p>
        ) : null}
        {canMoveSecret && (
          <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
            <div>
              <Button variant="outline" size="sm" onClick={moveSecret} disabled={moving}>
                {moving ? "Setting up replies" : headerMode ? "Set up replies again" : "Set up replies"}
              </Button>
            </div>
          </div>
        )}
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
        <strong>Heads up:</strong> Whapi links your number the way WhatsApp Web does. It isn&rsquo;t an official WhatsApp service, so
        WhatsApp can ban a number that looks like spam. Message people who contacted you or opted in, and use the business number, not a
        personal one.
      </div>
    </div>
  );
}
