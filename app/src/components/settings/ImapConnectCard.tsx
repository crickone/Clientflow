"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown, Mail, Plug, ShieldCheck, Unplug } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import {
  connectImapAction,
  disconnectImapAction,
  testImapConnectionAction,
} from "@/app/settings/email/imapActions";
import type { ImapFormInput } from "@/app/settings/email/imapActions";
// Type-only — imapEmail.ts is `server-only`; importing just the type keeps
// it out of this client bundle.
import type { ImapConnection } from "@/lib/imapEmail";

type FormState = {
  email: string;
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
};

const EMPTY_FORM: FormState = {
  email: "",
  password: "",
  imapHost: "",
  imapPort: 993,
  imapSecure: true,
  smtpHost: "",
  smtpPort: 465,
  smtpSecure: true,
};

/**
 * "Connect other email (IMAP/SMTP)" — the generic "bring your own mailbox"
 * counterpart to GmailConnectCard's OAuth flow. Mirrors its shape (header +
 * "Active sender" badge + connected/not-connected content in one Card), but
 * the not-connected state is a username/password FORM posting to server
 * actions instead of an OAuth redirect link.
 *
 * The password never leaves this form as anything but a value posted to
 * testImapConnectionAction/connectImapAction — neither action's result nor
 * the ImapConnection type carries it back, so it's never re-rendered into
 * the DOM after submit.
 */
export function ImapConnectCard({
  connection,
  active,
}: {
  connection: ImapConnection | null;
  active: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, startTest] = useTransition();
  const [connecting, startConnect] = useTransition();
  const [disconnecting, startDisconnect] = useTransition();

  const busy = testing || connecting || disconnecting;
  const canSubmit = form.email.trim().length > 0 && form.password.length > 0;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setTestResult(null);
    setForm((f) => ({ ...f, [key]: value }));
  }

  /** IF the host fields are still blank, auto-fill mail.<domain> + the usual ports/TLS. */
  function handleEmailBlur() {
    const email = form.email.trim();
    const at = email.indexOf("@");
    if (at < 0 || at === email.length - 1) return;
    const domain = email.slice(at + 1).trim().toLowerCase();
    if (!domain) return;
    setForm((f) => {
      if (f.imapHost.trim() || f.smtpHost.trim()) return f; // already customized — leave it
      return {
        ...f,
        imapHost: `mail.${domain}`,
        smtpHost: `mail.${domain}`,
        imapPort: 993,
        smtpPort: 465,
        imapSecure: true,
        smtpSecure: true,
      };
    });
  }

  function payload(): ImapFormInput {
    return {
      email: form.email.trim(),
      password: form.password,
      imapHost: form.imapHost.trim(),
      imapPort: form.imapPort,
      imapSecure: form.imapSecure,
      smtpHost: form.smtpHost.trim(),
      smtpPort: form.smtpPort,
      smtpSecure: form.smtpSecure,
    };
  }

  function runTest() {
    if (!canSubmit) return;
    const input = payload();
    startTest(async () => {
      const res = await testImapConnectionAction(input);
      if (res.ok) {
        setTestResult({ ok: true, message: "Connection works." });
        toast.success("Connection works");
      } else {
        setTestResult({ ok: false, message: res.error });
        toast.error(res.error);
      }
    });
  }

  function runConnect() {
    if (!canSubmit) return;
    const input = payload();
    startConnect(async () => {
      const res = await connectImapAction(input);
      if (!res.ok) {
        setTestResult({ ok: false, message: res.error });
        toast.error(res.error);
        return;
      }
      toast.success(`Connected ${input.email}`);
      router.refresh();
    });
  }

  function disconnect() {
    startDisconnect(async () => {
      const res = await disconnectImapAction();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Mailbox disconnected");
      router.refresh();
    });
  }

  return (
    <Card style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Mail size={16} strokeWidth={1.75} />
        <strong style={{ fontSize: 14, color: "var(--text-primary)" }}>
          Connect other email (IMAP/SMTP)
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

      {connection ? (
        <>
          <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
            Connected as <strong style={{ color: "var(--text-primary)" }}>{connection.email}</strong>.
            Emails send from this mailbox over SMTP, and it&apos;s a full two-way
            inbox — replies are read and sent from Communication.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="ghost" onClick={disconnect} disabled={disconnecting}>
              <Unplug size={14} /> {disconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runConnect();
          }}
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
          <div style={{ fontSize: 13, color: "var(--text-tertiary)", lineHeight: 1.55 }}>
            Send from your own mailbox — Microsoft 365, cPanel/Hostinger, or any
            other IMAP/SMTP provider. Emails go out over SMTP and replies sync
            back into ClientFlow.
          </div>

          <div>
            <Label htmlFor="imap-email">Email</Label>
            <Input
              id="imap-email"
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              onBlur={handleEmailBlur}
              placeholder="you@yourdomain.com"
              autoComplete="username"
              disabled={busy}
            />
          </div>

          <div>
            <Label htmlFor="imap-password">Password</Label>
            <Input
              id="imap-password"
              type="password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              placeholder="Mailbox password"
              autoComplete="current-password"
              disabled={busy}
            />
          </div>

          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            aria-expanded={advancedOpen}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              alignSelf: "flex-start",
              background: "transparent",
              border: "none",
              padding: 0,
              color: "var(--text-tertiary)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <ChevronDown
              size={14}
              style={{
                transition: "transform 0.15s var(--ease)",
                transform: advancedOpen ? "rotate(0deg)" : "rotate(-90deg)",
                opacity: 0.7,
              }}
            />
            Advanced — IMAP/SMTP host settings
          </button>

          {advancedOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingLeft: 20 }}>
              <Hint>
                Hosts auto-fill from your email once you tab out of it. cPanel
                mailbox? Find the host and password under the mailbox&apos;s{" "}
                <strong>Connect Devices</strong> page.
              </Hint>

              <SectionLabel>Incoming (IMAP)</SectionLabel>
              <div>
                <Label htmlFor="imap-host">Host</Label>
                <Input
                  id="imap-host"
                  value={form.imapHost}
                  onChange={(e) => set("imapHost", e.target.value)}
                  placeholder="mail.yourdomain.com"
                  disabled={busy}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "end" }}>
                <div>
                  <Label htmlFor="imap-port">Port</Label>
                  <Input
                    id="imap-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={form.imapPort}
                    onChange={(e) => set("imapPort", Number(e.target.value))}
                    disabled={busy}
                  />
                </div>
                <CheckboxField
                  id="imap-secure"
                  checked={form.imapSecure}
                  onChange={(v) => set("imapSecure", v)}
                  label="Use SSL/TLS"
                  disabled={busy}
                />
              </div>

              <SectionLabel style={{ marginTop: 4 }}>Outgoing (SMTP)</SectionLabel>
              <div>
                <Label htmlFor="smtp-host">Host</Label>
                <Input
                  id="smtp-host"
                  value={form.smtpHost}
                  onChange={(e) => set("smtpHost", e.target.value)}
                  placeholder="mail.yourdomain.com"
                  disabled={busy}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "end" }}>
                <div>
                  <Label htmlFor="smtp-port">Port</Label>
                  <Input
                    id="smtp-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={form.smtpPort}
                    onChange={(e) => set("smtpPort", Number(e.target.value))}
                    disabled={busy}
                  />
                </div>
                <CheckboxField
                  id="smtp-secure"
                  checked={form.smtpSecure}
                  onChange={(v) => set("smtpSecure", v)}
                  label="Use SSL/TLS"
                  disabled={busy}
                />
              </div>
            </div>
          )}

          {testResult && <Banner tone={testResult.ok ? "ok" : "warn"}>{testResult.message}</Banner>}

          <div style={{ display: "flex", gap: 8 }}>
            <Button type="button" variant="secondary" onClick={runTest} disabled={busy || !canSubmit}>
              {testing ? "Testing…" : "Test connection"}
            </Button>
            <Button type="submit" disabled={busy || !canSubmit}>
              <Plug size={14} /> {connecting ? "Connecting…" : "Connect"}
            </Button>
          </div>
        </form>
      )}

      <DeliverabilityNote />
    </Card>
  );
}

/** Standing reminder: shared-mailbox deliverability hinges on domain auth. Shown
 *  in both connected and not-connected states — it's about the domain's DNS,
 *  not the connection itself. Steps live in cPanel's Email Deliverability tool. */
function DeliverabilityNote() {
  return (
    <div
      style={{
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12.5,
          fontWeight: 600,
          color: "var(--text-primary)",
        }}
      >
        <ShieldCheck size={14} strokeWidth={1.75} />
        Deliverability — set this up so email doesn&apos;t land in spam
      </div>
      <div style={{ fontSize: 12, color: "var(--text-tertiary)", lineHeight: 1.55 }}>
        A shared mailbox reaches the inbox reliably only when the domain is authenticated. In your
        hosting&apos;s <strong>cPanel → Email Deliverability</strong>, get <strong>SPF</strong>,{" "}
        <strong>DKIM</strong> and <strong>DMARC</strong> all showing green — most hosts have a one-click{" "}
        <strong>Repair</strong>. Ideal for 1-to-1 client email; for large marketing blasts use a dedicated
        sending service instead.
      </div>
    </div>
  );
}

function CheckboxField({
  id,
  checked,
  onChange,
  label,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        color: "var(--text-secondary)",
        paddingBottom: 10,
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      {label}
    </label>
  );
}

function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        fontSize: 11,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "var(--text-tertiary)",
        fontWeight: 600,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: "var(--text-tertiary)", fontSize: 12, lineHeight: 1.5 }}>{children}</div>
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
