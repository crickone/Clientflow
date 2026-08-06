"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Mail } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import {
  saveEmailSenderAction,
  sendTestEmailAction,
} from "@/app/settings/email/actions";
import type { EmailSender } from "@/lib/email";

export function EmailSettingsForm({
  initial,
  apiKeyPresent,
  businessName,
  gmailActive,
}: {
  initial: EmailSender;
  apiKeyPresent: boolean;
  businessName: string;
  gmailActive?: boolean;
}) {
  const [fromName, setFromName] = useState(initial.fromName);
  const [fromEmail, setFromEmail] = useState(initial.fromEmail);
  const [replyTo, setReplyTo] = useState(initial.replyTo);
  const [testTo, setTestTo] = useState("");
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();

  const domain = fromEmail.includes("@") ? fromEmail.split("@")[1] : "";

  function save() {
    startSave(async () => {
      const res = await saveEmailSenderAction({ fromName, fromEmail, replyTo });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success("Email sender saved");
    });
  }

  function sendTest() {
    startTest(async () => {
      const res = await sendTestEmailAction(testTo);
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(`Test email sent to ${testTo}`);
      setTestTo("");
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
          fontWeight: 600,
        }}
      >
        Or send via your own domain (Resend)
      </div>
      {gmailActive && (
        <Banner tone="ok" icon={<CheckCircle2 size={16} />}>
          Gmail is your active sender, so these Resend settings are just a fallback
          for if you disconnect Gmail.
        </Banner>
      )}
      {/* Platform key status */}
      {apiKeyPresent ? (
        <Banner tone="ok" icon={<CheckCircle2 size={16} />}>
          Email service connected. Emails will send from your address below once
          its domain is verified in Resend.
        </Banner>
      ) : (
        <Banner tone="warn" icon={<AlertTriangle size={16} />}>
          Email service isn&apos;t connected yet. Add a <code>RESEND_API_KEY</code>{" "}
          on the server to enable sending. You can still save your sender details
          below.
        </Banner>
      )}

      <Card style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <Label htmlFor="from-name">Sender name</Label>
          <Input
            id="from-name"
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
            placeholder={businessName}
            disabled={saving}
          />
          <Hint>The name recipients see in their inbox.</Hint>
        </div>

        <div>
          <Label htmlFor="from-email">From address</Label>
          <Input
            id="from-email"
            type="email"
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value.toLowerCase())}
            placeholder="hello@yourdomain.ie"
            disabled={saving}
          />
          <Hint>
            Must be on a domain you&apos;ve <strong>verified in Resend</strong>
            {domain ? (
              <>
                {" "}
                — verify <strong>{domain}</strong> in Resend → Domains, then add the
                DNS records they give you.
              </>
            ) : (
              "."
            )}
          </Hint>
        </div>

        <div>
          <Label htmlFor="reply-to">Reply-to address (optional)</Label>
          <Input
            id="reply-to"
            type="email"
            value={replyTo}
            onChange={(e) => setReplyTo(e.target.value.toLowerCase())}
            placeholder={fromEmail || "replies@yourdomain.ie"}
            disabled={saving}
          />
          <Hint>Where client replies land. Defaults to the from address.</Hint>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save sender"}
          </Button>
        </div>
      </Card>

      {/* Test send */}
      <Card style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Mail size={16} strokeWidth={1.75} />
          <strong style={{ fontSize: 14, color: "var(--text-primary)" }}>
            Send a test email
          </strong>
        </div>
        <Hint>
          Confirm your domain + key are working. Until the domain is verified,
          Resend only delivers to your own account email.
        </Hint>
        <div style={{ display: "flex", gap: 8 }}>
          <Input
            type="email"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="you@example.com"
            disabled={testing}
            style={{ flex: 1 }}
          />
          <Button
            variant="secondary"
            onClick={sendTest}
            disabled={testing || !testTo.trim() || !apiKeyPresent}
          >
            {testing ? "Sending…" : "Send test"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: "ok" | "warn";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const palette =
    tone === "ok"
      ? { bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.3)", fg: "var(--text-secondary)" }
      : { bg: "rgba(217,119,6,0.08)", border: "rgba(217,119,6,0.3)", fg: "var(--text-secondary)" };
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: "var(--radius)",
        padding: "12px 14px",
        fontSize: 13,
        lineHeight: 1.5,
        color: palette.fg,
      }}
    >
      <span style={{ flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div>{children}</div>
    </div>
  );
}
