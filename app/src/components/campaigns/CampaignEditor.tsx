"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Save, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input, Textarea, Label } from "@/components/ui/Input";
import {
  createCampaignAction,
  draftCampaignBodyAction,
  sendCampaignAction,
  updateCampaignAction,
  type CampaignFormInput,
} from "@/app/campaigns/actions";
// Type-only — lib/marketing/campaigns.ts is `server-only`; importing just the
// types keeps it out of this client bundle (mirrors DomainConnectCard's
// SendingDomainRecord import).
import type { CampaignAudience, CampaignRecord } from "@/lib/marketing/campaigns";

const STATUS_TONE: Record<CampaignRecord["status"], "neutral" | "amber" | "green" | "red"> = {
  draft: "neutral",
  sending: "amber",
  sent: "green",
  paused: "amber",
  failed: "red",
};

interface Props {
  /** null when composing a brand-new campaign; the saved record when editing one. */
  campaign: CampaignRecord | null;
  /** Distinct tags across all contacts, for the "tagged…" audience option. */
  availableTags: string[];
  /** Recipient count as of the campaign's last save (not a live/unsaved preview). Only meaningful when `campaign` is set. */
  recipientCount?: number | null;
  defaultFromName?: string;
  defaultFromEmail?: string;
  /** The tenant's verified sending domain, if connected — shown as a hint near From. */
  sendingDomain?: string | null;
}

/**
 * The campaign composer (Task 4). One component handles BOTH creating a new
 * campaign and editing an existing draft — a brand-new campaign is really
 * just an edit session with `campaign: null` and nothing saved yet, so
 * there's one form, one Save handler, and no separate "quick create" step.
 * Mirrors DomainConnectCard's shape (useTransition + toast + router
 * navigation per action, never a raw form POST).
 */
export function CampaignEditor({
  campaign,
  availableTags,
  recipientCount,
  defaultFromName,
  defaultFromEmail,
  sendingDomain,
}: Props) {
  const router = useRouter();
  const isNew = campaign === null;
  const locked = campaign !== null && campaign.status !== "draft";

  const [name, setName] = useState(campaign?.name ?? "");
  const [subject, setSubject] = useState(campaign?.subject ?? "");
  const [preheader, setPreheader] = useState(campaign?.preheader ?? "");
  const [fromName, setFromName] = useState(campaign?.fromName ?? defaultFromName ?? "");
  const [fromEmail, setFromEmail] = useState(campaign?.fromEmail ?? defaultFromEmail ?? "");
  const [body, setBody] = useState(campaign?.bodyHtml ?? "");

  const initialTag = campaign && campaign.audience.kind === "tag" ? campaign.audience.tag : availableTags[0] ?? "";
  const [audienceKind, setAudienceKind] = useState<CampaignAudience["kind"]>(campaign?.audience.kind ?? "all_subscribed");
  const [audienceTag, setAudienceTag] = useState(initialTag);

  // AI-draft inputs — ephemeral, never persisted on the campaign row (the
  // campaign only stores the resulting body text once generated).
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState("");
  const [aiAudience, setAiAudience] = useState("");
  const [targetWords, setTargetWords] = useState(150);

  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [drafting, startDraft] = useTransition();
  const [sending, startSend] = useTransition();
  const busy = saving || drafting || sending;

  const canSave = name.trim() && subject.trim() && fromName.trim() && fromEmail.trim();

  function currentAudience(): CampaignAudience {
    return audienceKind === "tag" && audienceTag ? { kind: "tag", tag: audienceTag } : { kind: "all_subscribed" };
  }

  function save() {
    setError(null);
    const input: CampaignFormInput = {
      name,
      subject,
      preheader: preheader || null,
      fromName,
      fromEmail,
      bodyHtml: body,
      audience: currentAudience(),
    };
    startSave(async () => {
      const res = isNew ? await createCampaignAction(input) : await updateCampaignAction(campaign!.id, input);
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      if (isNew) {
        toast.success("Campaign created");
        router.push(`/campaigns/${res.campaign.id}`);
      } else {
        toast.success("Draft saved");
        router.refresh();
      }
    });
  }

  function draft() {
    if (!subject.trim()) {
      toast.error("Add a subject line first.");
      return;
    }
    if (!topic.trim()) {
      toast.error("Describe what this email is about.");
      return;
    }
    if (body.trim() && !window.confirm("Replace the current body with a new AI draft?")) {
      return;
    }
    startDraft(async () => {
      const res = await draftCampaignBodyAction({
        subject,
        topic,
        tone: tone || undefined,
        audience: aiAudience || undefined,
        targetWords,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setBody(res.content);
      toast.success("Draft generated — review and edit before saving.");
    });
  }

  function send() {
    if (!campaign) return;
    const who = recipientCount != null ? `${recipientCount.toLocaleString()} recipient${recipientCount === 1 ? "" : "s"}` : "your audience";
    if (!window.confirm(`Send "${campaign.name}" to ${who} now? This can't be undone.`)) {
      return;
    }
    startSend(async () => {
      const res = await sendCampaignAction(campaign.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Sending — this can take a few minutes for larger lists.");
      router.refresh();
    });
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 24, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
        <Card style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <Label htmlFor="c-name">Campaign name</Label>
            <Input
              id="c-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Internal name, e.g. August newsletter"
              disabled={locked}
            />
          </div>
          <div>
            <Label htmlFor="c-subject">Subject line</Label>
            <Input
              id="c-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="What recipients see in their inbox"
              disabled={locked}
            />
          </div>
          <div>
            <Label htmlFor="c-preheader">Preheader (optional)</Label>
            <Input
              id="c-preheader"
              value={preheader}
              onChange={(e) => setPreheader(e.target.value)}
              placeholder="Short preview text shown after the subject"
              disabled={locked}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <Label htmlFor="c-fromname">From name</Label>
              <Input
                id="c-fromname"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="Your business name"
                disabled={locked}
              />
            </div>
            <div>
              <Label htmlFor="c-fromemail">From address</Label>
              <Input
                id="c-fromemail"
                value={fromEmail}
                onChange={(e) => setFromEmail(e.target.value)}
                placeholder="hello@yourbusiness.com"
                disabled={locked}
              />
            </div>
          </div>
          {sendingDomain && (
            <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
              Verified sending domain: <strong style={{ color: "var(--text-secondary)" }}>{sendingDomain}</strong>
            </div>
          )}
        </Card>

        <Card style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Sparkles size={14} strokeWidth={1.75} />
            <strong style={{ fontSize: 14, color: "var(--text-primary)" }}>AI draft</strong>
          </div>
          <div>
            <Label htmlFor="ai-topic">What&apos;s this email about?</Label>
            <Input
              id="ai-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. announcing our new evening opening hours"
              disabled={locked}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 14 }}>
            <div>
              <Label htmlFor="ai-tone">Tone (optional)</Label>
              <Input
                id="ai-tone"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                placeholder="e.g. warm and low-key"
                disabled={locked}
              />
            </div>
            <div>
              <Label htmlFor="ai-words">Target words</Label>
              <Input
                id="ai-words"
                type="number"
                min={40}
                max={600}
                value={targetWords}
                onChange={(e) => setTargetWords(Number(e.target.value) || 150)}
                disabled={locked}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="ai-audience">Who&apos;s this for? (optional)</Label>
            <Input
              id="ai-audience"
              value={aiAudience}
              onChange={(e) => setAiAudience(e.target.value)}
              placeholder="e.g. existing clients who haven't booked in a while"
              disabled={locked}
            />
          </div>
          <div>
            <Button type="button" variant="secondary" onClick={draft} disabled={busy || locked}>
              <Sparkles size={14} /> {drafting ? "Drafting…" : "AI draft"}
            </Button>
          </div>

          <div>
            <Label htmlFor="c-body">Body</Label>
            <Textarea
              id="c-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={16}
              placeholder="Plain text — short paragraphs separated by a blank line. Formatted into a branded email when this campaign sends."
              disabled={locked}
            />
          </div>
        </Card>

        {error && (
          <div
            style={{
              background: "rgba(248,113,113,0.08)",
              border: "1px solid rgba(248,113,113,0.3)",
              borderRadius: "var(--radius)",
              padding: "10px 12px",
              fontSize: 13,
              color: "var(--text-secondary)",
            }}
          >
            {error}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <Card style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Mail size={16} strokeWidth={1.75} />
            <strong style={{ fontSize: 14, color: "var(--text-primary)" }}>Audience</strong>
            {campaign && (
              <span style={{ marginLeft: "auto" }}>
                <Badge tone={STATUS_TONE[campaign.status]}>{campaign.status}</Badge>
              </span>
            )}
          </div>

          {locked && (
            <div style={{ fontSize: 12, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
              This campaign is {campaign!.status} and can no longer be edited.
            </div>
          )}

          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--text-secondary)" }}>
            <input
              type="radio"
              name="audience"
              checked={audienceKind === "all_subscribed"}
              onChange={() => setAudienceKind("all_subscribed")}
              disabled={locked}
            />
            All subscribed contacts
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--text-secondary)" }}>
            <input
              type="radio"
              name="audience"
              checked={audienceKind === "tag"}
              onChange={() => setAudienceKind("tag")}
              disabled={locked || availableTags.length === 0}
            />
            Contacts tagged…
          </label>

          {audienceKind === "tag" &&
            (availableTags.length > 0 ? (
              <select
                className="field"
                value={audienceTag}
                onChange={(e) => setAudienceTag(e.target.value)}
                disabled={locked}
                style={selectStyle}
              >
                {availableTags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>No tags on any contact yet.</div>
            ))}

          {campaign && recipientCount != null && (
            <div style={{ fontSize: 12, color: "var(--text-tertiary)", borderTop: "1px solid var(--hairline)", paddingTop: 12 }}>
              {recipientCount.toLocaleString()} recipient{recipientCount === 1 ? "" : "s"} as of last save.
            </div>
          )}
        </Card>

        <Card style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <Button onClick={save} disabled={busy || !canSave || locked} loading={saving}>
            <Save size={14} /> {isNew ? "Create campaign" : "Save draft"}
          </Button>
          <Button
            variant="secondary"
            onClick={send}
            disabled={isNew || locked || busy}
            loading={sending}
            title={
              isNew
                ? "Save the campaign as a draft first."
                : locked
                  ? `This campaign is already ${campaign!.status} and can't be sent again.`
                  : undefined
            }
          >
            <Send size={14} /> {sending ? "Sending…" : "Send campaign"}
          </Button>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
            {isNew
              ? "Save this campaign as a draft first, then come back to send it."
              : locked
                ? `This campaign is ${campaign!.status} and can't be sent again.`
                : "Sends immediately to every eligible, subscribed recipient — this can't be undone."}
          </div>
        </Card>
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--surface-1)",
  border: "1px solid var(--grid)",
  borderRadius: "var(--radius)",
  padding: "10px 14px",
  color: "var(--text-primary)",
  fontSize: 14,
  outline: "none",
  fontFamily: "inherit",
};
