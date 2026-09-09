"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { updateBusinessProfile } from "@/app/settings/business/actions";
import type { BusinessProfile } from "@/lib/businessProfile";
import { SaveStatus } from "./SaveStatus";
import { useAutosave } from "./useAutosave";

const MARKETING_BRAIN_PLACEHOLDER = `Industry: e.g. Strength & conditioning gym
Audience: who you serve and their goals
Content pillars: the topics to write about
Tone: how it should sound
Always / Never: guardrails`;

const MARKETING_BRAIN_TEMPLATE = `You are the marketing voice for a strength & conditioning gym.

Industry & focus:
- A community gym offering coach-led strength, conditioning, mobility and circuit training, plus practical nutrition coaching.

Who we serve:
- Men and women of all levels, from complete beginners to experienced lifters, who want real results in a supportive, no-ego environment.

Content pillars (write about these):
- Strength training and programming
- Conditioning, fat loss and building endurance
- Practical, sustainable nutrition (protein, balanced eating, habits)
- Recovery, mobility and consistency
- Member motivation, community and accountability

Tone:
- Irish English (analyse, organise, behaviour) — never American spellings.
- Energetic and motivational, but grounded and real. Speak to results, consistency and community.

Always:
- Be encouraging and practical; give specific, useful tips.
- Keep it inclusive and welcoming to beginners.

Never:
- Promise guaranteed results, use body-shaming, or make medical/therapeutic claims.
- Mention recovery clinics, HBOT, infrared, PEMF or any wellness-clinic therapies.
- Use hype words ("revolutionary", "miracle", "unlock", "game-changer").`;

export function BusinessProfileForm({ initial }: { initial: BusinessProfile }) {
  const [profile, setProfile] = useState<BusinessProfile>(initial);
  const confirm = useConfirm();

  const autosave = useAutosave({
    values: profile,
    save: async (next) => {
      const res = await updateBusinessProfile(next);
      if (!res.ok) throw new Error("Couldn't save — please try again.");
    },
  });

  function set<K extends keyof BusinessProfile>(key: K, value: string) {
    setProfile((p) => ({ ...p, [key]: value }));
  }

  function setFaq(i: number, key: "q" | "a", value: string) {
    setProfile((p) => ({
      ...p,
      faqs: p.faqs.map((f, idx) => (idx === i ? { ...f, [key]: value } : f)),
    }));
  }
  function addFaq() {
    setProfile((p) => ({ ...p, faqs: [...p.faqs, { q: "", a: "" }] }));
  }
  function removeFaq(i: number) {
    setProfile((p) => ({ ...p, faqs: p.faqs.filter((_, idx) => idx !== i) }));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Card>
        <CardLabel>Identity</CardLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Field label="Business name" value={profile.businessName} onChange={(v) => set("businessName", v)} />
          <Field label="Tagline" value={profile.tagline} onChange={(v) => set("tagline", v)} />
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Location" value={profile.location} onChange={(v) => set("location", v)} />
          </div>
          <Field label="Phone" value={profile.phone} onChange={(v) => set("phone", v)} />
          <Field label="Website" value={profile.website} onChange={(v) => set("website", v)} />
          <Field
            label="Sign-up page URL"
            value={profile.signupUrl}
            onChange={(v) => set("signupUrl", v)}
          />
          <Field label="Email" value={profile.email} onChange={(v) => set("email", v)} type="email" />
        </div>
      </Card>

      <Card>
        <CardLabel>Brief</CardLabel>
        <Label htmlFor="brief" srOnly>What the business does, who it serves, what makes it distinctive</Label>
        <Textarea
          id="brief"
          rows={5}
          value={profile.brief}
          onChange={(e) => set("brief", e.target.value)}
          placeholder="What the business does, who it serves, what makes it distinctive"
        />
        <div style={{ marginTop: 16 }}>
          <Label htmlFor="voiceNotes" srOnly>Tone notes (optional)</Label>
          <Textarea
            id="voiceNotes"
            rows={2}
            value={profile.voiceNotes}
            onChange={(e) => set("voiceNotes", e.target.value)}
            placeholder="Tone notes (optional)"
          />
        </div>
      </Card>

      <Card>
        <CardLabel>Marketing brain</CardLabel>
        <Label htmlFor="marketingBrain">
          Master prompt — dictates the industry, subject matter and tone for ALL
          AI content (blogs, carousels, captions)
        </Label>
        <p style={{ color: "var(--text-secondary)", fontSize: 13, margin: "4px 0 8px" }}>
          When filled in, this overrides the generic voice so your content stays
          on-brand and on-topic. Be specific: who you are, who you serve, what to
          write about, the tone, and what to avoid.
        </p>
        <Textarea
          id="marketingBrain"
          rows={12}
          value={profile.marketingBrain}
          onChange={(e) => set("marketingBrain", e.target.value)}
          placeholder={MARKETING_BRAIN_PLACEHOLDER}
        />
        <div style={{ marginTop: 10 }}>
          <Button
            variant="outline"
            onClick={async () => {
              if (
                profile.marketingBrain.trim() &&
                !(await confirm({ title: "Replace the marketing brain?", body: "This overwrites your current marketing brain with the starter template.", confirmLabel: "Replace" }))
              )
                return;
              set("marketingBrain", MARKETING_BRAIN_TEMPLATE);
            }}
          >
            Insert starter template
          </Button>
        </div>
      </Card>

      <Card>
        <CardLabel>Policies &amp; FAQs</CardLabel>
        <Label htmlFor="policies" srOnly>Policies (cancellation, payment, etc.)</Label>
        <Textarea
          id="policies"
          rows={3}
          value={profile.policies}
          onChange={(e) => set("policies", e.target.value)}
          placeholder="Policies (cancellation, payment, etc.)"
        />
        <div style={{ marginTop: 20 }}>
          <Label>Key FAQs — the AI answers these directly</Label>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              marginTop: 8,
            }}
          >
            {profile.faqs.length === 0 && (
              <p
                style={{
                  color: "var(--text-tertiary)",
                  fontSize: 13,
                  margin: 0,
                }}
              >
                No FAQs yet. Add the questions people ask most — opening hours,
                parking, what to wear, how to book…
              </p>
            )}
            {profile.faqs.map((f, i) => (
              <div
                key={i}
                style={{ display: "flex", gap: 8, alignItems: "flex-start" }}
              >
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <Input
                    value={f.q}
                    placeholder="Question"
                    onChange={(e) => setFaq(i, "q", e.target.value)}
                  />
                  <Textarea
                    rows={2}
                    value={f.a}
                    placeholder="Answer"
                    onChange={(e) => setFaq(i, "a", e.target.value)}
                  />
                </div>
                <Button variant="outline" onClick={() => removeFaq(i)}>
                  <Trash2 size={15} />
                </Button>
              </div>
            ))}
            <div>
              <Button variant="outline" onClick={addFaq}>
                <Plus size={15} /> Add FAQ
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardLabel>Connected business data</CardLabel>
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: 13,
            marginTop: 0,
          }}
        >
          Your services, prices, and opening hours feed the AI automatically.
          Manage them here:
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/settings/therapies">
            <Button variant="outline">Services &amp; prices</Button>
          </Link>
          <Link href="/settings/schedule">
            <Button variant="outline">Opening hours</Button>
          </Link>
        </div>
      </Card>

      <SaveStatus autosave={autosave} />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  // The field carries its own name as placeholder text, so the label is only
  // there for screen readers — it still needs a real id to point at.
  const id = useId();
  return (
    <div>
      <Label htmlFor={id} srOnly>
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={label}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
