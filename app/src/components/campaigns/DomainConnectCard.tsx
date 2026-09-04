"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Globe, Plug, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input, Label } from "@/components/ui/Input";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  connectSendingDomainAction,
  disconnectSendingDomainAction,
  refreshSendingDomainAction,
} from "@/app/campaigns/domains/actions";
// Type-only — lib/marketing/domains.ts is `server-only`; importing just the
// type keeps it out of this client bundle (mirrors ImapConnectCard's
// ImapConnection import).
import type { SendingDomainRecord } from "@/lib/marketing/domains";

const STATE_TONE: Record<SendingDomainRecord["state"], "neutral" | "amber" | "green" | "red"> = {
  unverified: "amber",
  verified: "green",
  failed: "red",
};

/**
 * "Connect a sending domain" — the GHL-style email marketing add-on's
 * counterpart to ImapConnectCard, whose connected/not-connected Card shape
 * (header + status badge, useTransition + toast + router.refresh per action)
 * it mirrors. Not-connected is an "enter a domain" form; connected shows the
 * DNS records the provider asked for plus a "Check verification" button that
 * re-polls the provider (refreshSendingDomainAction) rather than a passive
 * status display.
 */
export function DomainConnectCard({ domain }: { domain: SendingDomainRecord | null }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connecting, startConnect] = useTransition();
  const [refreshing, startRefresh] = useTransition();
  const [disconnecting, startDisconnect] = useTransition();

  const busy = connecting || refreshing || disconnecting;

  function connect() {
    const clean = value.trim();
    if (!clean) return;
    setError(null);
    startConnect(async () => {
      const res = await connectSendingDomainAction(clean);
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success(`Connected ${res.record.domain}`);
      setValue("");
      router.refresh();
    });
  }

  function refresh() {
    startRefresh(async () => {
      const res = await refreshSendingDomainAction();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.record.state === "verified") toast.success("Domain verified");
      else toast(`Still ${res.record.state} — DNS can take a while to propagate.`);
      router.refresh();
    });
  }

  async function disconnect() {
    if (
      !(await confirm({
        title: "Disconnect this sending domain?",
        body: domain
          ? `Campaigns will stop sending from ${domain.domain} until you reconnect and re-verify it.`
          : "Campaigns will stop sending from this domain until you reconnect and re-verify it.",
        confirmLabel: "Disconnect",
        destructive: true,
      }))
    ) {
      return;
    }
    startDisconnect(async () => {
      const res = await disconnectSendingDomainAction();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Sending domain disconnected");
      router.refresh();
    });
  }

  return (
    <Card style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Globe size={16} strokeWidth={1.75} />
        <strong style={{ fontSize: 14, color: "var(--text-primary)" }}>Sending domain</strong>
        {domain && (
          <span style={{ marginLeft: "auto" }}>
            <Badge tone={STATE_TONE[domain.state]}>{domain.state}</Badge>
          </span>
        )}
      </div>

      {domain ? (
        <>
          <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
            Sending from <strong style={{ color: "var(--text-primary)" }}>{domain.domain}</strong>.
            {domain.state === "verified"
              ? " DNS is verified — campaigns can send from this domain."
              : " Publish the DNS records below at your domain registrar, then check verification. Click any value to copy it."}
          </div>

          {domain.dnsRecords.length > 0 && (
            <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Type</th>
                    <th style={th}>Name</th>
                    <th style={th}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {domain.dnsRecords.map((r, i) => (
                    <tr key={i}>
                      <td style={td}>{r.type}</td>
                      <CopyCell text={r.name} />
                      <CopyCell text={r.value} breakAll />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="secondary" onClick={refresh} disabled={busy}>
              <RefreshCw size={14} /> {refreshing ? "Checking…" : "Check verification"}
            </Button>
            <Button variant="ghost" onClick={disconnect} disabled={busy}>
              <Unplug size={14} /> {disconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            connect();
          }}
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
          <div style={{ fontSize: 13, color: "var(--text-tertiary)", lineHeight: 1.55 }}>
            Connect a domain (or subdomain — e.g. <code>mg.yourbusiness.ie</code>) to send campaigns from your
            own address instead of a shared one. We&apos;ll give you DNS records to publish at your registrar.
          </div>

          <div>
            <Label htmlFor="sending-domain" srOnly>Domain</Label>
            <Input
              id="sending-domain"
              value={value}
              onChange={(e) => {
                setError(null);
                setValue(e.target.value);
              }}
              placeholder="Domain"
              disabled={busy}
            />
          </div>

          {error && <Banner>{error}</Banner>}

          <div>
            <Button type="submit" disabled={busy || !value.trim()}>
              <Plug size={14} /> {connecting ? "Connecting…" : "Connect domain"}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "rgba(217,119,6,0.08)",
        border: "1px solid rgba(217,119,6,0.3)",
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

/**
 * A DNS-record cell you click to copy — the whole cell is the button, and it
 * flashes a green check on success. navigator.clipboard needs a secure context
 * (prod is always HTTPS); the rejection path tells the operator to copy by hand.
 */
function CopyCell({ text, breakAll = false }: { text: string; breakAll?: boolean }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      },
      () => toast.error("Couldn't copy automatically — select the value and copy it manually."),
    );
  }

  return (
    <td style={{ ...td, ...mono, padding: 0, ...(breakAll ? { wordBreak: "break-all" } : null) }}>
      <Tooltip label="Click to copy">
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : `Copy ${text}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "10px 12px",
            background: copied ? "rgba(22,163,74,0.10)" : "transparent",
            border: "none",
            cursor: "pointer",
            font: "inherit",
            color: "inherit",
            textAlign: "left",
            transition: "background 140ms ease",
            ...(breakAll ? { wordBreak: "break-all" } : null),
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>{text}</span>
          {copied ? (
            <Check size={13} strokeWidth={2} style={{ color: "#16a34a", flexShrink: 0 }} />
          ) : (
            <Copy size={13} strokeWidth={1.75} style={{ opacity: 0.4, flexShrink: 0 }} />
          )}
        </button>
      </Tooltip>
    </td>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  fontSize: 11,
  fontWeight: 500,
  color: "var(--text-tertiary)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  borderBottom: "1px solid var(--hairline)",
  whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--hairline)",
  fontSize: 13,
  color: "var(--text-secondary)",
};
const mono: React.CSSProperties = {
  fontFamily: "var(--font-mono), ui-monospace, monospace",
  fontSize: 12,
};
