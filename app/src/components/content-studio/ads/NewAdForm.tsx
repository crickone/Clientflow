"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Clapperboard, Film, ImageIcon, Link2, Sparkles, Users, Video, X } from "lucide-react";

import { createImageAdAction } from "@/app/content-studio/ads/actions";
import { AD_GOALS, AD_GOAL_LABEL, GOAL_BUTTON, type AdGoal } from "@/lib/ads/adCopy";
import { titleFrom } from "@/lib/content-studio/title";
import { AdIdeas, type AdIdea } from "./AdIdeas";
import { AdSketch } from "./AdSketch";

/**
 * Start an ad, in the same composer as a new post: say what it's for (or pick
 * one of Adonis's concepts), choose image or video, and watch the shape of it
 * in the preview beside the box. Adonis then writes three versions on
 * different angles and designs each in the three ad sizes (image), or cuts the
 * clip as an ad (video).
 */
type Kind = "image" | "video";
type Phase = "saving" | "starting" | "opening";

const STEP_MIN_MS = 800;
const OPEN_HOLD_MS = 900;
const holdFor = (since: number, ms: number) =>
  new Promise<void>((r) => setTimeout(r, Math.max(0, ms - (Date.now() - since))));

/** A picked concept writes its line into the brief as "Lead with: ...", which the preview reads back. */
const LEAD = /(?:^|\n)\s*Lead with:\s*(.+)\s*$/i;

export interface NewAdFormProps {
  website: string;
  hasDesignSystem: boolean;
  businessName: string;
  logoUrl: string | null;
  photoUrl: string | null;
  accentColor?: string;
}

export function NewAdForm(props: NewAdFormProps) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("image");
  const [offer, setOffer] = useState("");
  const [audience, setAudience] = useState("");
  const [goal, setGoal] = useState<AdGoal>("bookings");
  const [linkUrl, setLinkUrl] = useState(/^https:\/\//.test(props.website) ? props.website : "");
  const [clip, setClip] = useState<File | null>(null);
  const [broll, setBroll] = useState<File[]>([]);
  const [seconds, setSeconds] = useState(25);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clipInput = useRef<HTMLInputElement>(null);
  const brollInput = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  // The box grows with the brief: a picked concept is several lines, and a
  // fixed three rows hid the angle and the line it leads with.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [offer, phase]);

  const video = kind === "video";
  const needsLink = goal === "website" || goal === "bookings";
  const lead = offer.match(LEAD)?.[1]?.trim() ?? "";
  const body = offer.replace(LEAD, "").replace(/\n\s*Angle:.*$/im, "").trim();
  const hook = lead || titleFrom(body, 60);
  const blocked = !video && !props.hasDesignSystem;
  const ready = offer.trim().length >= 3 && !blocked && (!video || !!clip);

  const phases: { id: Phase; label: string }[] = [
    { id: "saving", label: video ? "Uploading the clip" : "Saving the brief" },
    { id: "starting", label: "Handing the brief to Adonis" },
    { id: "opening", label: video ? "Opening the ad, where the cut arrives" : "Opening the ad, where the versions arrive" },
  ];

  function pickIdea(idea: AdIdea) {
    setOffer(`${idea.offer}\n\nAngle: ${idea.angle}\nLead with: ${idea.hook}`);
    setAudience(idea.audience);
    setGoal(idea.goal);
    setError(null);
  }

  async function create() {
    if (phase) return;
    if (!offer.trim()) return void setError("Say what the ad is for first.");
    if (video && !clip) return void setError("Add the clip the ad is cut from.");
    setError(null);
    setPhase("saving");
    const shown = Date.now();
    let id: number | null = null;

    if (video) {
      const form = new FormData();
      form.set("offer", offer);
      form.set("audience", audience);
      form.set("goal", goal);
      form.set("linkUrl", needsLink ? linkUrl : "");
      form.set("seconds", String(seconds));
      form.set("main", clip!);
      for (const f of broll) form.append("broll", f);
      try {
        const res = await fetch("/api/content-studio/ads/video", { method: "POST", body: form });
        const d = (await res.json().catch(() => null)) as { ok?: boolean; id?: number; error?: string } | null;
        if (d?.ok && d.id) id = d.id;
        else setError(d?.error ?? `The upload failed (HTTP ${res.status}). Try again.`);
      } catch {
        setError("The upload failed. Check the connection and try again.");
      }
    } else {
      const res = await createImageAdAction({ offer, audience, goal, linkUrl: needsLink ? linkUrl : "" }).catch(() => ({
        ok: false as const,
        error: "Couldn't reach the server. Give it a few seconds and try again.",
      }));
      if (res.ok) id = res.id;
      else setError(res.error);
    }

    if (!id) return void setPhase(null);
    await holdFor(shown, STEP_MIN_MS);
    setPhase("starting");
    await holdFor(Date.now(), STEP_MIN_MS);
    setPhase("opening");
    await holdFor(Date.now(), OPEN_HOLD_MS);
    router.push(`/content-studio/ads/${id}`);
  }

  return (
    <div className="nc">
      <div className="nc-main">
        {phase ? (
          <section className="nc-card nc-progress" aria-live="polite">
            <div className="nc-progress-kicker">{video ? "Adonis is cutting your video ad" : "Adonis is making your ad, three versions"}</div>
            <h2 className="nc-progress-title">{hook || titleFrom(offer, 120)}</h2>
            <ol className="nc-steps">
              {phases.map((p, i) => {
                const at = phases.findIndex((x) => x.id === phase);
                const state = i < at ? "done" : i === at ? "active" : "todo";
                return (
                  <li key={p.id} className={`nc-step is-${state}`}>
                    <span className="nc-step-mark">{state === "done" && <Check size={13} strokeWidth={3} />}</span>
                    {p.label}
                  </li>
                );
              })}
            </ol>
            <p className="nc-progress-note">Adonis keeps going if you leave the page. The ad is in Content Studio when it&rsquo;s ready.</p>
          </section>
        ) : (
          <section className="nc-card">
            <label htmlFor="ad-offer" className="nc-label">
              What&rsquo;s this ad for?
            </label>
            <textarea
              id="ad-offer"
              ref={box}
              className="nc-input"
              value={offer}
              onChange={(e) => setOffer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (ready) void create();
                }
              }}
              rows={3}
              maxLength={600}
              placeholder="e.g. a block of five hyperbaric oxygen sessions in Clonmel, for people who train hard and recover slowly"
            />

            <div className="na-fields">
              <label className="na-field">
                <Users size={15} aria-hidden />
                <input value={audience} onChange={(e) => setAudience(e.target.value)} maxLength={300} placeholder="Who it's for (optional)" aria-label="Who the ad is for" />
              </label>
              {needsLink && (
                <label className="na-field">
                  <Link2 size={15} aria-hidden />
                  <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} maxLength={500} placeholder="Where the button goes, https://" aria-label="Where the button goes" inputMode="url" />
                </label>
              )}
            </div>

            {video && (
              <div className="na-clips">
                <input ref={clipInput} type="file" accept="video/*" hidden onChange={(e) => setClip(e.target.files?.[0] ?? null)} />
                <input ref={brollInput} type="file" accept="video/*" multiple hidden onChange={(e) => setBroll(Array.from(e.target.files ?? []))} />
                {clip ? (
                  <span className="na-file is-main">
                    <Clapperboard size={15} aria-hidden />
                    <span className="na-file-name">{clip.name}</span>
                    <button type="button" aria-label="Remove the clip" onClick={() => setClip(null)}>
                      <X size={14} />
                    </button>
                  </span>
                ) : (
                  <button type="button" className="na-drop" onClick={() => clipInput.current?.click()}>
                    <Clapperboard size={16} aria-hidden />
                    <span>
                      <strong>Add the clip</strong>
                      <span>Someone talking to camera works best</span>
                    </span>
                  </button>
                )}
                {broll.length > 0 ? (
                  <span className="na-file">
                    <Film size={15} aria-hidden />
                    <span className="na-file-name">{broll.length === 1 ? broll[0].name : `${broll.length} b-roll clips`}</span>
                    <button type="button" aria-label="Remove the b-roll" onClick={() => setBroll([])}>
                      <X size={14} />
                    </button>
                  </span>
                ) : (
                  <button type="button" className="na-add" onClick={() => brollInput.current?.click()}>
                    <Film size={15} aria-hidden /> Add b-roll (optional)
                  </button>
                )}
                <select aria-label="Length" className="nc-slides" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
                  <option value={15}>Up to 15 seconds</option>
                  <option value={25}>Up to 25 seconds</option>
                  <option value={40}>Up to 40 seconds</option>
                </select>
              </div>
            )}

            <div className="nc-bar">
              <div className="nc-format" role="group" aria-label="Kind of ad">
                <button type="button" aria-pressed={!video} className={!video ? "is-on" : undefined} onClick={() => setKind("image")}>
                  <ImageIcon size={15} /> Image ad
                </button>
                <button type="button" aria-pressed={video} className={video ? "is-on" : undefined} onClick={() => setKind("video")}>
                  <Video size={15} /> Video ad
                </button>
              </div>
              <select aria-label="What should people do?" className="nc-slides" value={goal} onChange={(e) => setGoal(e.target.value as AdGoal)}>
                {AD_GOALS.map((g) => (
                  <option key={g} value={g}>
                    {AD_GOAL_LABEL[g]}
                  </option>
                ))}
              </select>
              <span className="nc-bar-gap" />
              <button
                type="button"
                className="btn btn--primary btn--md nc-go"
                onClick={() => void create()}
                disabled={!ready}
                title={ready ? "Press Enter to create" : video && !clip ? "Add the clip first" : "Say what the ad is for first"}
              >
                <Sparkles size={15} /> Create it with Adonis
              </button>
            </div>
          </section>
        )}

        {blocked && !phase && (
          <div className="nc-notice">
            Image ads are designed in your brand&rsquo;s style. Choose one in{" "}
            <Link href="/settings/design" className="inbox-link">
              Settings &gt; Design direction
            </Link>{" "}
            first, or make a video ad.
          </div>
        )}
        {error && <div className="nc-error" role="alert">{error}</div>}

        {!phase && <AdIdeas onPick={pickIdea} />}
      </div>

      <AdSketch
        kind={kind}
        hook={hook}
        caption={body}
        button={GOAL_BUTTON[goal]}
        businessName={props.businessName}
        logoUrl={props.logoUrl}
        photoUrl={props.photoUrl}
        accentColor={props.accentColor}
        clip={clip}
      />
    </div>
  );
}
