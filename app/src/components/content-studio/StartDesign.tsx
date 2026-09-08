"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Sparkles, PenLine } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Label, Textarea } from "@/components/ui/Input";
import { PostIdeas } from "./PostIdeas";
import { DEFAULT_CAROUSEL_SLOT, DEFAULT_SLOT } from "@/lib/image/slots";

/**
 * Step 1 of the image flow: say what you're making before anything else.
 *
 * This replaces a page that silently created a design and dropped you into the
 * editor, where the first thing you met was a 32-template grid — a styling
 * decision, asked before you'd said what the post was even about. It also
 * retires the naming collision that made the old flow so confusing: generation
 * was a toolbar button called "Generate carousel" sitting next to a template
 * tab called "Carousels" that did something entirely different. Here,
 * generating IS the first step, so there's nothing to confuse it with.
 */
type Kind = "carousel" | "single";

/**
 * The carousel slot generated slides land in. Matches the fallback the editor's
 * own generate flow uses, so both routes end up in the same place.
 */
const CAROUSEL_SLOT = DEFAULT_CAROUSEL_SLOT;

export function StartDesign() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [kind, setKind] = useState<Kind>("carousel");
  const [slides, setSlides] = useState(5);
  const [busy, setBusy] = useState<null | "ai" | "manual">(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * The editor only treats a slot as a carousel when its key says so, and
   * generation writes into a slot. So a carousel has to be seeded into
   * CAROUSEL_SLOT — seeding the single-image "default" slot would put the
   * slides where the Carousels tab can't see them, and the design would open
   * on a Carousels tab reporting every slot empty.
   */
  async function createDesign(seedSlideCount: number): Promise<number | null> {
    const name = topic.trim() ? topic.trim().slice(0, 80) : "Untitled design";
    const carousel = kind === "carousel";
    // Every failure used to collapse into one message, because a .catch()
    // around .json() swallows the cause: a 500, a redirect to /login, and the
    // browser failing to connect at all read identically. That cost a whole
    // debugging round when a deploy's container swap produced "Couldn't start
    // a new design" and there was nothing to go on. Each case now says what
    // actually happened.
    let res: Response;
    try {
      res = await fetch("/api/content-studio/carousels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          seedSlotKey: carousel ? CAROUSEL_SLOT : DEFAULT_SLOT,
          seedTemplateId: carousel ? CAROUSEL_SLOT : "bold-headline",
          seedSlideCount,
        }),
      });
    } catch {
      setError(
        "Couldn't reach the server. If the app was just updated, give it a few seconds and try again.",
      );
      return null;
    }
    if (res.status === 401 || res.redirected) {
      setError("Your session expired. Reload the page and sign in again.");
      return null;
    }
    let d: { ok?: boolean; error?: string; carouselId?: number } | null = null;
    try {
      d = await res.json();
    } catch {
      setError(
        `The server returned an unexpected response (HTTP ${res.status}). Try again in a moment.`,
      );
      return null;
    }
    if (!d?.ok) {
      setError(d?.error ?? `Couldn't start a new design (HTTP ${res.status}).`);
      return null;
    }
    return d.carouselId as number;
  }

  async function startManually() {
    setBusy("manual");
    setError(null);
    // Writing it themselves means they get the slides they asked for, blank.
    const id = await createDesign(kind === "carousel" ? slides : 1);
    if (id) router.push(`/content-studio/images/${id}`);
    else setBusy(null);
  }

  async function startWithAi() {
    if (!topic.trim()) {
      setError("Tell Adonis what the post is about first.");
      return;
    }
    setBusy("ai");
    setError(null);
    // One seed slide only: generation replaces the whole slot, so seeding the
    // full count here would just be deleted a second later.
    const id = await createDesign(1);
    if (!id) {
      setBusy(null);
      return;
    }
    // A single post is one slide, so there's no series to write — the editor's
    // Refresh copy writes it from the business context. Only a carousel goes
    // through the series generator.
    if (kind === "single") {
      router.push(`/content-studio/images/${id}`);
      return;
    }
    let gen: { ok?: boolean; error?: string } | null = null;
    try {
      const res = await fetch(`/api/content-studio/carousels/${id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          slideCount: slides,
          slotKey: CAROUSEL_SLOT,
        }),
      });
      gen = await res.json();
      if (!gen?.ok && !gen?.error) {
        gen = { ok: false, error: `The generator failed (HTTP ${res.status}).` };
      }
    } catch {
      gen = {
        ok: false,
        error: "Lost contact with the server while writing the slides.",
      };
    }
    if (!gen?.ok) {
      // STAY PUT on failure. This used to set the error and navigate in the
      // same breath, so the message was destroyed by the route change and the
      // operator landed in an editor holding one seed slide with no idea why —
      // which is exactly how a truncated generation looked in production.
      // The reason is usually something they can act on here ("try fewer
      // slides"), so it belongs on the screen with the controls that change it.
      setError(
        `${gen?.error ?? "Couldn't write the slides."} Your draft was saved — you can open it and generate again from there.`,
      );
      setBusy(null);
      return;
    }
    router.push(`/content-studio/images/${id}`);
  }

  const working = busy !== null;

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 22 }}>
        <Label htmlFor="topic" srOnly>
          What&rsquo;s this post about?
        </Label>
        <h2 style={{ margin: "0 0 6px", fontSize: 19, fontWeight: 600, letterSpacing: "-0.01em" }}>
          What&rsquo;s this post about?
        </h2>
        <p style={{ margin: "0 0 14px", fontSize: 13.5, color: "var(--text-secondary)", maxWidth: "62ch" }}>
          One line is enough. Adonis writes the copy from your business, your marketing
          brain and this month&rsquo;s plan — you edit anything you don&rsquo;t like.
        </p>
        <Textarea
          id="topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. why over-35s should lift weights, for people who think it's too late to start"
          style={{ minHeight: 84 }}
        />
        <PostIdeas onPick={(hook) => setTopic(hook)} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        {(
          [
            { id: "carousel", title: "Carousel", blurb: "A set of slides people swipe through. Best for teaching something.", bars: 5 },
            { id: "single", title: "Single post", blurb: "One image. Best for a statement, an offer or a quote.", bars: 1 },
          ] as const
        ).map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setKind(o.id)}
            aria-pressed={kind === o.id}
            style={{
              textAlign: "left",
              background: kind === o.id ? "var(--surface-2)" : "var(--surface-1)",
              border: `1px solid ${kind === o.id ? "var(--text-primary)" : "var(--hairline)"}`,
              borderRadius: "var(--radius)",
              padding: 16,
              cursor: "pointer",
              fontFamily: "inherit",
              color: "inherit",
            }}
          >
            <span style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 3 }}>
              {o.title}
            </span>
            <span style={{ display: "block", fontSize: 12.5, color: "var(--text-tertiary)" }}>
              {o.blurb}
            </span>
            <span style={{ display: "flex", gap: 4, marginTop: 10 }} aria-hidden>
              {Array.from({ length: o.bars }, (_, i) => (
                <span
                  key={i}
                  style={{
                    width: 15,
                    height: 19,
                    borderRadius: 2,
                    background: kind === o.id ? "var(--hairline-strong)" : "var(--surface-3)",
                  }}
                />
              ))}
            </span>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {kind === "carousel" && (
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Label htmlFor="slides" srOnly>
              Number of slides
            </Label>
            <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>Slides</span>
            <select
              id="slides"
              value={slides}
              onChange={(e) => setSlides(Number(e.target.value))}
              style={{
                background: "var(--field-bg)",
                border: "1px solid transparent",
                borderRadius: "var(--radius-field)",
                padding: "11px 14px",
                color: "var(--text-primary)",
                fontSize: 14,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </span>
        )}
        <Button onClick={startWithAi} disabled={working}>
          {busy === "ai" ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
          {busy === "ai" ? "Writing…" : "Write it with Adonis"}
        </Button>
        <Button variant="ghost" onClick={startManually} disabled={working}>
          <PenLine size={15} />
          I&rsquo;ll write it myself
        </Button>
      </div>

      {error && (
        <div style={{ marginTop: 12, fontSize: 13, color: "var(--danger)" }}>{error}</div>
      )}
      {busy === "ai" && kind === "carousel" && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--text-tertiary)" }}>
          Writing {slides} slides — this takes a few seconds.
        </div>
      )}
    </div>
  );
}
