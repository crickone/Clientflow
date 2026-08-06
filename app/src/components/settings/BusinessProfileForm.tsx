"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { updateBusinessProfile } from "@/app/settings/business/actions";
import type { BusinessProfile } from "@/lib/businessProfile";

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
  const [isPending, startTransition] = useTransition();
  const confirm = useConfirm();
  const router = useRouter();

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

  function save() {
    startTransition(async () => {
      const res = await updateBusinessProfile(profile);
      if (res.ok) {
        toast.success("Business profile saved.");
        router.refresh();
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Card>
        <CardLabel>Identity</CardLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Field label="Business name" value={profile.businessName} onChange={(v) => set("businessName", v)} />
          <Field label="Tagline" value={profile.tagline} onChange={(v) => set("tagline", v)} placeholder="e.g. what your business is" />
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Location" value={profile.location} onChange={(v) => set("location", v)} />
          </div>
          <Field label="Phone" value={profile.phone} onChange={(v) => set("phone", v)} />
          <Field label="Website" value={profile.website} onChange={(v) => set("website", v)} />
          <Field label="Email" value={profile.email} onChange={(v) => set("email", v)} type="email" />
        </div>
      </Card>

      <Card>
        <CardLabel>Brief</CardLabel>
        <Label htmlFor="brief">What the business does, who it serves, what makes it distinctive</Label>
        <Textarea
          id="brief"
          rows={5}
          value={profile.brief}
          onChange={(e) => set("brief", e.target.value)}
          placeholder="Used to generate content (blogs, carousels) about your business. e.g. who you serve, what you offer, and what makes you different."
        />
        <div style={{ marginTop: 16 }}>
          <Label htmlFor="voiceNotes">Tone notes (optional)</Label>
          <Textarea
            id="voiceNotes"
            rows={2}
            value={profile.voiceNotes}
            onChange={(e) => set("voiceNotes", e.target.value)}
            placeholder="Any extra tone guidance layered on top of the venue voice. e.g. warm but professional; avoid jargon."
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
        <Label htmlFor="policies">Policies (cancellation, payment, etc.)</Label>
        <Textarea
          id="policies"
          rows={3}
          value={profile.policies}
          onChange={(e) => set("policies", e.target.value)}
          placeholder="e.g. 24 hours' notice required to reschedule. Payment on the day by card or cash."
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

      <div
        style={{
          position: "sticky",
          bottom: 12,
          zIndex: 5,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          background: "var(--surface-1)",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius)",
          boxShadow: "var(--shadow-1)",
        }}
      >
        <span
          style={{
            marginRight: "auto",
            color: "var(--text-tertiary)",
            fontSize: 13,
          }}
        >
          Changes aren&apos;t saved until you click Save.
        </span>
        <Button onClick={save} disabled={isPending}>
          {isPending ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
