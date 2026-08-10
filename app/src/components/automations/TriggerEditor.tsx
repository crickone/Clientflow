"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileText, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { ComingSoonBadge, Switch } from "@/components/automations/TriggerListView";
import { saveTriggerAction } from "@/app/automations/actions";
import {
  applyShortcodes,
  blankMessage,
  CHANNEL_LABEL,
  LIVE_CHANNEL,
  SHORTCODES,
  type Channel,
  type MessageInput,
  type TriggerStatus,
} from "@/lib/automationModel";

interface Detail {
  key: string;
  label: string;
  description: string;
  status: TriggerStatus;
  enabled: boolean;
  externalEnabled: boolean;
  messages: MessageInput[];
}

export function TriggerEditor({ initial, businessName }: { initial: Detail; businessName: string }) {
  const router = useRouter();
  const comingSoon = initial.status === "coming_soon";
  const [enabled, setEnabled] = useState(initial.enabled);
  const [externalEnabled, setExternalEnabled] = useState(initial.externalEnabled);
  const [messages, setMessages] = useState<MessageInput[]>(
    initial.messages.length ? initial.messages : [blankMessage()],
  );
  const [saving, start] = useTransition();

  const patch = (i: number, p: Partial<MessageInput>) =>
    setMessages((prev) => prev.map((m, j) => (j === i ? { ...m, ...p } : m)));
  const removeMsg = (i: number) => setMessages((prev) => prev.filter((_, j) => j !== i));
  const addMsg = () => setMessages((prev) => [...prev, blankMessage()]);

  const save = () => {
    start(async () => {
      const res = await saveTriggerAction({
        key: initial.key,
        enabled,
        externalEnabled,
        messages: messages.filter((m) => m.template.trim() || m.attachmentFilename),
      });
      if (res.ok) {
        toast.success("Trigger saved.");
        router.push("/automations");
        router.refresh();
      } else toast.error(res.error);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Button variant="ghost" size="icon" onClick={() => router.push("/automations")} aria-label="Back">
          <ArrowLeft size={16} />
        </Button>
        <h1 style={{ margin: 0, fontFamily: "var(--font-heading), sans-serif", fontSize: 24, textTransform: "uppercase" }}>Trigger</h1>
        {comingSoon && <ComingSoonBadge />}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
            {comingSoon ? "Not available yet" : enabled ? "Active" : "Inactive"}
          </span>
          <Switch on={enabled} onClick={() => setEnabled((v) => !v)} disabled={comingSoon} />
        </div>
      </div>

      {/* External automation (Zapier) */}
      <div style={{ ...card, flexDirection: "row", alignItems: "center", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
            External automation {externalEnabled ? "enabled" : "disabled"}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5, marginTop: 3 }}>
            Connect Zapier to trigger routine, repetitive tasks automatically when this event fires.
          </div>
        </div>
        <Switch on={externalEnabled} onClick={() => setExternalEnabled((v) => !v)} />
      </div>

      {/* Name */}
      <div style={card}>
        <Label>Name</Label>
        <div style={{ padding: "12px 14px", borderRadius: "var(--radius)", background: "var(--surface-2)", border: "1px solid var(--hairline)", textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--text-primary)", fontSize: 14 }}>
          {initial.label}
        </div>
      </div>

      {/* Message series */}
      {comingSoon ? (
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Nothing to configure here yet</div>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            This trigger isn&apos;t wired up to send anything yet — no message series exists for it today, so
            there&apos;s nothing to write or schedule here. We&apos;ll open up sending for &ldquo;{initial.label}&rdquo; in a
            future update.
          </div>
        </div>
      ) : (
        <>
          {messages.map((m, i) => (
            <MessageCard
              key={i}
              index={i}
              message={m}
              canRemove={messages.length > 1}
              onPatch={(p) => patch(i, p)}
              onRemove={() => removeMsg(i)}
              businessName={businessName}
            />
          ))}

          <div>
            <Button variant="outline" onClick={addMsg}>
              <Plus size={15} /> Add another message
            </Button>
          </div>
        </>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <Button variant="ghost" onClick={() => router.push("/automations")} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save trigger"}
        </Button>
      </div>
    </div>
  );
}

function MessageCard({
  index,
  message,
  canRemove,
  onPatch,
  onRemove,
  businessName,
}: {
  index: number;
  message: MessageInput;
  canRemove: boolean;
  onPatch: (p: Partial<MessageInput>) => void;
  onRemove: () => void;
  businessName: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/automations/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Upload failed.");
      onPatch({ attachmentFilename: data.filename, attachmentOriginal: data.originalName });
      toast.success("File attached.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ fontSize: 12.5, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-tertiary)", fontFamily: "var(--font-mono), monospace" }}>
          Message {index + 1}
        </div>
        {canRemove && (
          <button onClick={onRemove} aria-label="Remove message" style={{ marginLeft: "auto", background: "transparent", border: "none", color: "#f87171", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5 }}>
            <Trash2 size={14} /> Remove
          </button>
        )}
      </div>

      {/* channel */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" }}>Notifications</div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>What type of notification do you want to send?</div>
        </div>
        <div style={{ marginLeft: "auto", display: "inline-flex", border: "1px solid var(--hairline)", borderRadius: "var(--radius)", overflow: "hidden" }}>
          {(["email", "push", "chat"] as Channel[]).map((c) => {
            // Only LIVE_CHANNEL ("email") is ever actually dispatched — see
            // automationModel.ts's isMessageLive(). Push/chat stay visible
            // (so a historically-saved value is still legible) but disabled,
            // rather than silently accepting a choice that will never send
            // (improvement-plan-2026-08.md Theme D1).
            const live = c === LIVE_CHANNEL;
            const selected = message.channel === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => live && onPatch({ channel: c })}
                disabled={!live}
                title={live ? undefined : "Coming soon — only Email actually sends today"}
                style={{
                  padding: "8px 18px",
                  border: "none",
                  cursor: live ? "pointer" : "not-allowed",
                  fontSize: 13,
                  background: selected ? "var(--accent)" : "transparent",
                  color: selected ? "#fff" : live ? "var(--text-secondary)" : "var(--text-tertiary)",
                  opacity: live ? 1 : 0.6,
                }}
              >
                {CHANNEL_LABEL[c]}
                {!live && " (soon)"}
              </button>
            );
          })}
        </div>
      </div>

      {message.channel === "email" && (
        <div>
          <Label htmlFor={`subj-${index}`}>Subject</Label>
          <Input id={`subj-${index}`} value={message.subject ?? ""} onChange={(e) => onPatch({ subject: e.target.value })} placeholder="Email subject" />
        </div>
      )}

      <div>
        <Label>Template</Label>
        <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginBottom: 6 }}>
          Personalise with short-codes: {SHORTCODES.map((s) => <code key={s} style={codeTag}>{s}</code>)}
        </div>
        <Textarea value={message.template} onChange={(e) => onPatch({ template: e.target.value })} rows={6} placeholder="Hi [FIRST_NAME], …" />
        {message.template.trim() && (
          <div style={{ marginTop: 8, padding: "10px 12px", border: "1px dashed var(--hairline)", borderRadius: "var(--radius)", background: "var(--surface-2)" }}>
            <div style={{ fontSize: 10.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 4 }}>
              Preview (example client)
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
              {applyShortcodes(message.template, { firstName: "Aoife", lastName: "Brennan", businessName })}
            </div>
          </div>
        )}
      </div>

      {/* attachment */}
      <div>
        <Label>Attached file</Label>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
        {message.attachmentFilename ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, border: "1px solid var(--hairline)", borderRadius: "var(--radius)", padding: "10px 12px" }}>
            <FileText size={20} style={{ color: "var(--accent-ink)" }} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {message.attachmentOriginal ?? message.attachmentFilename}
            </span>
            <button onClick={() => onPatch({ attachmentFilename: null, attachmentOriginal: null })} aria-label="Remove file" style={{ background: "transparent", border: "none", color: "var(--text-tertiary)", cursor: "pointer" }}>
              <X size={16} />
            </button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 size={14} className="spin" /> : <Plus size={14} />} Choose file
          </Button>
        )}
      </div>

      {/* timing — disabled: every message sends immediately today (Theme D1) */}
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, opacity: 0.55 }}>
          <div>
            <Label htmlFor={`delay-${index}`}>When do you want to send this message?</Label>
            <Input id={`delay-${index}`} type="number" min={0} value={message.delayValue} disabled style={{ cursor: "not-allowed" }} />
          </div>
          <div>
            <Label htmlFor={`unit-${index}`}>Interval</Label>
            <select
              id={`unit-${index}`}
              value={message.delayUnit}
              disabled
              style={{ width: "100%", height: 40, padding: "0 12px", borderRadius: "var(--radius)", border: "1px solid var(--hairline)", background: "var(--surface-1)", color: "var(--text-primary)", fontSize: 13, cursor: "not-allowed" }}
            >
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 6 }}>
          Scheduled &amp; multi-channel sending coming soon — for now every message sends by Email, immediately.
        </div>
      </div>

      <div>
        <Button variant="ghost" size="sm" onClick={() => toast.success("Test send queued (demo).")}>
          Send test
        </Button>
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
  background: "var(--surface-1)",
  padding: 20,
};
const codeTag: React.CSSProperties = {
  fontFamily: "var(--font-mono), monospace",
  fontSize: 11,
  background: "var(--surface-2)",
  padding: "1px 6px",
  borderRadius: 4,
  marginRight: 5,
  color: "var(--accent-ink)",
};
