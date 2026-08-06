"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { AlertTriangle, Mail, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { sendClientEmailAction } from "@/app/clients/[id]/emailActions";
import type { ClientEmailRow } from "@/lib/clientEmail";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
// Deterministic UTC format — identical on server + client, avoids hydration drift.
function fmt(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm}`;
}

export function ClientEmailPanel({
  clientId,
  clientEmail,
  emailReady,
  history,
}: {
  clientId: number;
  clientEmail: string | null;
  emailReady: boolean;
  history: ClientEmailRow[];
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();

  function send() {
    if (!subject.trim() || !body.trim()) {
      toast.error("Add a subject and a message.");
      return;
    }
    start(async () => {
      const res = await sendClientEmailAction(clientId, { subject, body });
      if (!res.ok) { toast.error(res.error); return; }
      toast.success(`Email sent to ${clientEmail}`);
      setSubject("");
      setBody("");
    });
  }

  const canSend = Boolean(clientEmail) && emailReady && !pending;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!clientEmail && (
        <Notice>
          This client has no email address on file. Add one on their{" "}
          <Link href={`/clients/${clientId}/edit`} style={{ color: "var(--accent)" }}>
            edit page
          </Link>{" "}
          to email them.
        </Notice>
      )}
      {clientEmail && !emailReady && (
        <Notice>
          Email sending isn&apos;t set up yet. Configure your sender in{" "}
          <Link href="/settings/email" style={{ color: "var(--accent)" }}>
            Settings → Email
          </Link>
          .
        </Notice>
      )}

      <Card style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Mail size={16} strokeWidth={1.75} />
          <strong style={{ fontSize: 14, color: "var(--text-primary)" }}>
            {clientEmail ? `Email ${clientEmail}` : "Email this client"}
          </strong>
        </div>
        <div>
          <Label htmlFor="ce-subject">Subject</Label>
          <Input
            id="ce-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={pending}
            placeholder="e.g. Your session this week"
          />
        </div>
        <div>
          <Label htmlFor="ce-body">Message</Label>
          <textarea
            id="ce-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            placeholder="Write your message…"
            disabled={pending}
            style={{
              width: "100%",
              background: "var(--bg)",
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius)",
              padding: "10px 14px",
              color: "var(--text-primary)",
              fontSize: 14,
              fontFamily: "inherit",
              lineHeight: 1.55,
              resize: "vertical",
              outline: "none",
            }}
          />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button onClick={send} disabled={!canSend}>
            <Send size={14} strokeWidth={2} />
            {pending ? "Sending…" : "Send email"}
          </Button>
        </div>
      </Card>

      {history.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--text-tertiary)",
              fontWeight: 600,
            }}
          >
            Sent history
          </div>
          {history.map((m) => (
            <Card key={m.id} style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 14, color: "var(--text-primary)" }}>
                  {m.subject}
                </strong>
                {m.status === "failed" && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      color: "#dc2626",
                    }}
                  >
                    <AlertTriangle size={12} /> Failed
                  </span>
                )}
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-tertiary)" }}>
                  {fmt(m.createdAt)}
                </span>
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 13,
                  color: "var(--text-secondary)",
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.5,
                }}
              >
                {m.body}
              </div>
              {m.status === "failed" && m.error && (
                <div style={{ marginTop: 6, fontSize: 12, color: "#dc2626" }}>{m.error}</div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        background: "rgba(217,119,6,0.08)",
        border: "1px solid rgba(217,119,6,0.3)",
        borderRadius: "var(--radius)",
        padding: "12px 14px",
        fontSize: 13,
        lineHeight: 1.5,
        color: "var(--text-secondary)",
      }}
    >
      <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
      <div>{children}</div>
    </div>
  );
}
