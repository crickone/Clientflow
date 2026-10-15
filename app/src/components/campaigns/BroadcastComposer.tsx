"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { MAX_MESSAGE, renderBroadcast, sendDuration, validateBroadcast } from "@/lib/whatsappBroadcastModel";
import { deleteBroadcastAction, saveBroadcastAction, sendBroadcastAction } from "@/app/campaigns/whatsapp/actions";

type Audience = "everyone" | "active";

/** Write the message, pick who gets it, send now or later. Preview shows exactly what a member receives. */
export function BroadcastComposer({
  id,
  initial,
  counts,
  businessName,
  sampleName,
  connected,
}: {
  id: number;
  initial: { name: string; message: string; audience: Audience };
  counts: Record<Audience, number>;
  businessName: string;
  sampleName: string;
  connected: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [name, setName] = useState(initial.name);
  const [message, setMessage] = useState(initial.message);
  const [audience, setAudience] = useState<Audience>(initial.audience);
  const [mode, setMode] = useState<"now" | "later">("now");
  const [at, setAt] = useState("");
  const [pending, start] = useTransition();
  const count = counts[audience];
  const invalid = message.trim() ? validateBroadcast(message) : null;
  const draft = { name, message, audience };

  function insert(token: string) {
    setMessage((m) => (m && !m.endsWith(" ") ? `${m} ${token}` : `${m}${token}`));
  }

  function save() {
    start(async () => {
      const r = await saveBroadcastAction(id, draft);
      if (r.ok) toast.success("Draft saved.");
      else toast.error(r.error);
      router.refresh();
    });
  }

  async function send() {
    const problem = validateBroadcast(message);
    if (problem) return toast.error(problem);
    if (count === 0) return toast.error("Nobody in this audience has said yes to WhatsApp messages yet.");
    const sendAt = mode === "later" ? new Date(at).getTime() : null;
    if (mode === "later" && (!at || !Number.isFinite(sendAt) || sendAt! < Date.now())) return toast.error("Pick a time in the future.");
    const ok = await confirm({
      title: `Send to ${count} member${count === 1 ? "" : "s"}?`,
      body: `${mode === "later" ? `It starts ${new Date(sendAt!).toLocaleString("en-IE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "It starts now"} and takes ${sendDuration(count)}, between 9am and 9pm. You can stop it while it's sending.`,
      confirmLabel: mode === "later" ? "Schedule" : "Send",
    });
    if (!ok) return;
    start(async () => {
      const r = await sendBroadcastAction(id, draft, sendAt);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(mode === "later" ? `Scheduled for ${r.count} members.` : `Sending to ${r.count} members.`);
      router.refresh();
    });
  }

  async function remove() {
    if (!(await confirm({ title: "Delete this draft?", destructive: true }))) return;
    start(async () => {
      await deleteBroadcastAction(id);
    });
  }

  return (
    <div className="wb-grid">
      <Card className="wb-card">
        <label className="wb-field">
          <span>Name (only you see this)</span>
          <input className="wb-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </label>

        <label className="wb-field">
          <span>Message</span>
          <textarea className="wb-input wb-text" rows={8} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={MAX_MESSAGE + 200} placeholder="Hi [FIRST_NAME], ..." />
        </label>
        <div className="wb-tools">
          <button type="button" onClick={() => insert("[FIRST_NAME]")}>
            First name
          </button>
          <button type="button" onClick={() => insert("[BUSINESS_NAME]")}>
            Business name
          </button>
          <span data-over={message.length > MAX_MESSAGE}>
            {message.length} / {MAX_MESSAGE}
          </span>
        </div>
        {invalid && <p className="wb-err">{invalid}</p>}

        <fieldset className="wb-field">
          <legend>Who gets it</legend>
          {(["everyone", "active"] as Audience[]).map((a) => (
            <label key={a} className="wb-radio" data-on={audience === a}>
              <input type="radio" name="aud" checked={audience === a} onChange={() => setAudience(a)} />
              <span>{a === "everyone" ? "Everyone who said yes to WhatsApp" : "Only those with an active membership"}</span>
              <b>{counts[a]}</b>
            </label>
          ))}
        </fieldset>

        <fieldset className="wb-field">
          <legend>When</legend>
          <div className="wb-when">
            <label className="wb-radio" data-on={mode === "now"}>
              <input type="radio" name="when" checked={mode === "now"} onChange={() => setMode("now")} />
              <span>Now</span>
            </label>
            <label className="wb-radio" data-on={mode === "later"}>
              <input type="radio" name="when" checked={mode === "later"} onChange={() => setMode("later")} />
              <span>Later</span>
            </label>
            {mode === "later" && <input type="datetime-local" className="wb-input" value={at} onChange={(e) => setAt(e.target.value)} />}
          </div>
          <p className="wb-hint">Messages go out a few a minute between 9am and 9pm, so your number isn&rsquo;t flagged as spam. {count > 0 ? `This one takes ${sendDuration(count)}.` : ""}</p>
        </fieldset>

        <div className="wb-actions">
          <Button onClick={() => void send()} disabled={pending || !connected || !message.trim()}>
            <Send size={14} /> {mode === "later" ? "Schedule" : `Send to ${count}`}
          </Button>
          <Button variant="outline" onClick={save} disabled={pending}>
            <Save size={14} /> Save draft
          </Button>
          <Button variant="ghost" onClick={() => void remove()} disabled={pending} style={{ marginLeft: "auto" }}>
            <Trash2 size={14} /> Delete
          </Button>
        </div>
        {!connected && <p className="wb-err">Connect WhatsApp under Settings, Integrations, WhatsApp before sending.</p>}
      </Card>

      <div className="wb-preview">
        <div className="wb-preview-label">What {sampleName} gets</div>
        <div className="wb-phone">
          <div className="wb-bubble">{message.trim() ? renderBroadcast(message, { firstName: sampleName }, businessName) : "Your message shows here."}</div>
        </div>
      </div>
    </div>
  );
}
