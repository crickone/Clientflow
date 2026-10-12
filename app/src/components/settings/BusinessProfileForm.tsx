"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Circle, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { updateBusinessProfile } from "@/app/settings/business/actions";
import type { BusinessProfile } from "@/lib/businessProfile";
import { SaveStatus } from "./SaveStatus";
import { useAutosave } from "./useAutosave";

export function BusinessProfileForm({ initial, imageStyle = "" }: { initial: BusinessProfile; imageStyle?: string }) {
  const [profile, setProfile] = useState<BusinessProfile>(initial);
  // What the server last had from this form: each save sends only the fields
  // that differ from it, so nothing this form didn't change is overwritten.
  const baseRef = useRef<BusinessProfile>(initial);

  const autosave = useAutosave({
    values: profile,
    save: async (next) => {
      const base = baseRef.current;
      const patch: Partial<BusinessProfile> = {};
      for (const k of Object.keys(next) as (keyof BusinessProfile)[]) {
        if (JSON.stringify(next[k]) !== JSON.stringify(base[k])) (patch as Record<string, unknown>)[k] = next[k];
      }
      if (Object.keys(patch).length === 0) return;
      const res = await updateBusinessProfile(patch, { patchOnly: true });
      if (!res.ok) throw new Error(("error" in res && res.error) || "Couldn't save — please try again.");
      baseRef.current = next;
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

  const sections: { id: string; label: string; done: boolean }[] = [
    { id: "bp-identity", label: "Identity", done: !!(profile.businessName && profile.phone) },
    { id: "bp-brief", label: "Brief", done: !!profile.brief.trim() },
    { id: "bp-voice", label: "Tone", done: !!profile.voiceNotes.trim() },
    { id: "bp-brain", label: "Marketing brain", done: !!profile.marketingBrain.trim() },
    { id: "bp-photo", label: "Photo style", done: !!imageStyle.trim() },
    { id: "bp-policies", label: "Policies and FAQs", done: !!profile.policies.trim() || profile.faqs.length > 0 },
    { id: "bp-data", label: "Services and hours", done: true },
  ];
  const built = !!(profile.brief.trim() && profile.marketingBrain.trim());
  const place = profile.location.split(",").map((x) => x.trim()).filter(Boolean).slice(-2).join(", ");

  return (
    <div className="bp">
      <nav className="bp-nav" aria-label="Sections">
        {sections.map((x) => (
          <a key={x.id} href={`#${x.id}`} className="bp-nav-link">
            <span className={`bp-nav-dot${x.done ? " is-done" : ""}`} aria-hidden>
              {x.done && <Check size={10} strokeWidth={3.5} />}
            </span>
            {x.label}
          </a>
        ))}
      </nav>

      <div className="bp-main">
        <section className="bp-hero ui-card">
          <div className="bp-hero-text">
            <h2 className="bp-hero-name">{profile.businessName || "Your business"}</h2>
            <p className="bp-hero-meta">{[profile.tagline, place].filter(Boolean).join(" \u00b7 ") || "Add your details below."}</p>
            <div className="bp-chips">
              {sections.slice(1, 5).map((x) => (
                <span key={x.id} className={`bp-chip${x.done ? " is-done" : ""}`}>
                  {x.done ? <Check size={12} strokeWidth={3} /> : <Circle size={10} />}
                  {x.label}
                </span>
              ))}
            </div>
          </div>
          <Link href="/settings/business/interview" className={`btn ${built ? "btn--secondary" : "btn--primary"} btn--md bp-hero-cta`}>
            <Sparkles size={15} /> {built ? "Rebuild with Adonis" : "Build your brand with Adonis"}
          </Link>
        </section>

        <section id="bp-identity" className="bp-section">
          <SectionHead title="Identity" desc="Shown across the app and used in everything Adonis writes." />
          <div className="bp-grid">
            <Field label="Business name" value={profile.businessName} onChange={(v) => set("businessName", v)} />
            <Field label="Tagline (optional)" value={profile.tagline} onChange={(v) => set("tagline", v)} />
            <div className="bp-span">
              <Field label="Address" value={profile.location} onChange={(v) => set("location", v)} />
            </div>
            <Field label="Phone" value={profile.phone} onChange={(v) => set("phone", v)} />
            <Field label="Email" value={profile.email} onChange={(v) => set("email", v)} type="email" />
            <Field label="Website" value={profile.website} onChange={(v) => set("website", v)} />
            <Field label="Sign-up page link" value={profile.signupUrl} onChange={(v) => set("signupUrl", v)} />
          </div>
        </section>

        <section id="bp-brief" className="bp-section">
          <TextBlock
            title="Brief"
            desc="What the business is, who it serves and what makes it different. Every piece of content starts from this."
            value={profile.brief}
            onChange={(v) => set("brief", v)}
            emptyHint="No brief yet. Build your brand with Adonis, or write one."
          />
        </section>

        <section id="bp-voice" className="bp-section">
          <TextBlock
            title="Tone"
            desc="How your content should sound."
            value={profile.voiceNotes}
            onChange={(v) => set("voiceNotes", v)}
            emptyHint="No tone notes yet."
            lines
          />
        </section>

        <section id="bp-brain" className="bp-section">
          <TextBlock
            title="Marketing brain"
            desc="The master instructions for all AI content: who you serve, what to teach, how to sound, what never to say."
            value={profile.marketingBrain}
            onChange={(v) => set("marketingBrain", v)}
            emptyHint="No marketing brain yet. Build your brand with Adonis and it writes one from your answers."
            structured
          />
        </section>

        <section id="bp-photo" className="bp-section">
          <SectionHead
            title="Photo style"
            desc="The look of every photo Adonis makes for your posts and ads."
            action={
              <Link href="/settings/branding" className="bp-edit">
                <Pencil size={14} /> Edit in Branding
              </Link>
            }
          />
          {imageStyle.trim() ? <p className="bp-read">{imageStyle}</p> : <p className="bp-empty">Using the default style. Build your brand with Adonis to set one.</p>}
        </section>

        <section id="bp-policies" className="bp-section">
          <TextBlock
            title="Policies"
            desc="Cancellations, payments, what to bring. Adonis uses these when it answers messages."
            value={profile.policies}
            onChange={(v) => set("policies", v)}
            emptyHint="No policies yet."
            lines
          />
          <div className="bp-faqs">
            <SectionHead title="Questions people ask" desc="Adonis answers these directly in your inbox." />
            {profile.faqs.length === 0 && <p className="bp-empty">None yet. Add the ones you hear most: parking, what to wear, how to book.</p>}
            {profile.faqs.map((f, i) => (
              <div key={i} className="bp-faq">
                <div className="bp-faq-fields">
                  <Input value={f.q} placeholder="Question" onChange={(e) => setFaq(i, "q", e.target.value)} />
                  <AutoTextarea value={f.a} placeholder="Answer" onChange={(v) => setFaq(i, "a", v)} minRows={2} />
                </div>
                <button type="button" className="bp-icon-btn" aria-label="Remove this question" onClick={() => removeFaq(i)}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <div>
              <Button variant="outline" onClick={addFaq}>
                <Plus size={15} /> Add a question
              </Button>
            </div>
          </div>
        </section>

        <section id="bp-data" className="bp-section">
          <SectionHead title="Services and hours" desc="Your services, prices and opening hours feed Adonis automatically." />
          <div className="bp-links">
            <Link href="/settings/therapies" className="bp-link ui-card">
              Services and prices <ArrowRight size={15} />
            </Link>
            <Link href="/settings/schedule" className="bp-link ui-card">
              Opening hours <ArrowRight size={15} />
            </Link>
          </div>
        </section>

        <SaveStatus autosave={autosave} />
      </div>
    </div>
  );
}

function SectionHead({ title, desc, action }: { title: string; desc?: string; action?: React.ReactNode }) {
  return (
    <div className="bp-head">
      <div>
        <h3 className="bp-title">{title}</h3>
        {desc && <p className="bp-desc">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

/** A textarea that grows with its content instead of scrolling inside a small box. */
function AutoTextarea({
  value,
  onChange,
  placeholder,
  minRows = 3,
  autoFocus,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minRows?: number;
  autoFocus?: boolean;
  id?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <textarea
      id={id}
      ref={ref}
      className="bp-textarea"
      rows={minRows}
      value={value}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * A long text shown as readable text, with Edit switching to a growing text
 * box. `structured` reads "Heading:" lines and "- " lines as headings and
 * bullets (the marketing brain's own format); `lines` keeps line breaks.
 */
function TextBlock({
  title,
  desc,
  value,
  onChange,
  emptyHint,
  structured,
  lines,
}: {
  title: string;
  desc: string;
  value: string;
  onChange: (v: string) => void;
  emptyHint: string;
  structured?: boolean;
  lines?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const id = useId();
  return (
    <>
      <SectionHead
        title={title}
        desc={desc}
        action={
          <button type="button" className="bp-edit" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
            {editing ? (
              <>
                <Check size={14} /> Done
              </>
            ) : (
              <>
                <Pencil size={14} /> {value.trim() ? "Edit" : "Write"}
              </>
            )}
          </button>
        }
      />
      {editing ? (
        <AutoTextarea id={id} value={value} onChange={onChange} minRows={structured ? 12 : 4} autoFocus />
      ) : !value.trim() ? (
        <p className="bp-empty">{emptyHint}</p>
      ) : structured ? (
        <StructuredText text={value} />
      ) : (
        <p className={`bp-read${lines ? " is-lines" : ""}`}>{value}</p>
      )}
    </>
  );
}

function StructuredText({ text }: { text: string }) {
  const blocks: { head?: string; items: string[]; para: string[] }[] = [];
  let cur: { head?: string; items: string[]; para: string[] } = { items: [], para: [] };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[-\u2022*]\s+/.test(line)) cur.items.push(line.replace(/^[-\u2022*]\s+/, ""));
    else if (/:$/.test(line) && line.length < 80) {
      if (cur.head || cur.items.length || cur.para.length) blocks.push(cur);
      cur = { head: line.replace(/:$/, ""), items: [], para: [] };
    } else cur.para.push(line);
  }
  if (cur.head || cur.items.length || cur.para.length) blocks.push(cur);
  return (
    <div className="bp-structured">
      {blocks.map((b, i) => (
        <div key={i} className={b.head ? "bp-sblock" : "bp-sintro"}>
          {b.head && <h4 className="bp-shead">{b.head}</h4>}
          {b.para.map((p, j) => (
            <p key={j}>{p}</p>
          ))}
          {b.items.length > 0 && (
            <ul>
              {b.items.map((it, j) => (
                <li key={j}>{it}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
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
