"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, GalleryHorizontal, PenLine, Sparkles, Square } from "lucide-react";

import type { ImageLibraryAsset } from "@/lib/db/schema";
import type { BrandLabels } from "@/lib/image/paintSlide";
import { PostIdeas } from "./PostIdeas";
import { PostPreview } from "./PostPreview";
import { TemplateGallery } from "./TemplateGallery";
import { DEFAULT_CAROUSEL_SLOT, DEFAULT_SLOT } from "@/lib/image/slots";
import { titleFrom } from "@/lib/content-studio/title";
import { watchGeneration } from "./GenerationWatcher";

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
 * How long the client waits for the generation to be ACCEPTED. The route no
 * longer writes the slides inside the request -- it queues a detached run and
 * returns -- so this covers a handshake, not a minute of AI work. It exists
 * only to catch a connection that will never answer at all (a deploy swapping
 * the container mid-request is the usual one).
 */
const GENERATE_TIMEOUT_MS = 30_000;

/**
 * The carousel slot generated slides land in. Matches the fallback the editor's
 * own generate flow uses, so both routes end up in the same place.
 */
const CAROUSEL_SLOT = DEFAULT_CAROUSEL_SLOT;

export interface StartDesignProps {
  library: ImageLibraryAsset[];
  brand?: BrandLabels;
  defaultHeadingFontId: string;
  defaultBodyFontId: string;
  logoUrl: string | null;
  accentColor?: string;
}

/** What the Write button is doing, shown as steps in place of the composer. */
type Phase = "saving" | "starting" | "opening";
const PHASES: { id: Phase; label: string }[] = [
  { id: "saving", label: "Saving the draft" },
  { id: "starting", label: "Handing the brief to Adonis" },
  { id: "opening", label: "Opening the editor, where the slides arrive" },
];

export function StartDesign(props: StartDesignProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase | null>(null);
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
    // The topic box holds a BRIEF (the idea picker composes hook + what it
    // should teach + what it rests on), so a hard slice of it stored a
    // sentence cut mid-word as the design's name. The name is the hook.
    const name = titleFrom(topic, 80) || "Untitled design";
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
    if (busy) return;
    if (!topic.trim()) {
      setError("Tell Adonis what the post is about first.");
      return;
    }
    setBusy("ai");
    setPhase("saving");
    setError(null);
    // One seed slide only: generation replaces the whole slot, so seeding the
    // full count here would just be deleted a second later.
    const id = await createDesign(1);
    if (!id) {
      setBusy(null);
      setPhase(null);
      return;
    }
    setPhase("starting");
    // Only STARTS the run. The slides are written by a detached continuation on
    // the server, and the editor shows them arriving -- so the operator is free
    // to navigate anywhere from here, which is the whole point: this used to be
    // a minute-long request that clicking away from destroyed.
    let gen: { ok?: boolean; error?: string } | null = null;
    try {
      const res = await fetch(`/api/content-studio/carousels/${id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // A single post goes through the same generator as one slide, so it
        // is AI-designed exactly like a carousel when the business has a
        // design system (a template slide with written copy otherwise).
        body: JSON.stringify({
          topic: topic.trim(),
          slideCount: kind === "single" ? 1 : slides,
          slotKey: kind === "single" ? DEFAULT_SLOT : CAROUSEL_SLOT,
        }),
        signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
      });
      gen = await res.json();
      if (!gen?.ok && !gen?.error) {
        gen = { ok: false, error: `The generator failed (HTTP ${res.status}).` };
      }
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === "TimeoutError";
      gen = {
        ok: false,
        error: timedOut
          ? "The server didn't answer in time. This usually means the app restarted mid-request."
          : "Lost contact with the server while starting the generation.",
      };
    }
    if (!gen?.ok) {
      // STAY PUT on failure. This used to set the error and navigate in the
      // same breath, so the message was destroyed by the route change and the
      // operator landed in an editor holding one seed slide with no idea why.
      // The reason is usually something they can act on here ("try fewer
      // slides"), so it belongs on the screen with the controls that change it.
      setError(
        `${gen?.error ?? "Couldn't start writing the slides."} Your draft was saved — you can open it and generate again from there.`,
      );
      setBusy(null);
      setPhase(null);
      return;
    }
    setPhase("opening");
    // The run is detached and the operator is free to leave the editor it is
    // about to land in -- so register the watch that notifies them when the
    // slides are done, wherever they have got to by then. Same click that
    // justifies asking for notification permission.
    watchGeneration(id, titleFrom(topic, 80) || "Untitled design");
    router.push(`/content-studio/images/${id}`);
  }

  const working = busy !== null;
  const carousel = kind === "carousel";
  const ready = topic.trim().length > 0;

  return (
    <div className="nc">
      <div className="nc-main">
        {phase ? (
          <section className="nc-card nc-progress" aria-live="polite">
            <div className="nc-progress-kicker">{carousel ? `Adonis is making your ${slides}-slide carousel` : "Adonis is making your post"}</div>
            <h2 className="nc-progress-title">{titleFrom(topic, 120)}</h2>
            <ol className="nc-steps">
              {PHASES.map((p, i) => {
                const at = PHASES.findIndex((x) => x.id === phase);
                const state = i < at ? "done" : i === at ? "active" : "todo";
                return (
                  <li key={p.id} className={`nc-step is-${state}`}>
                    <span className="nc-step-mark">{state === "done" && <Check size={13} strokeWidth={3} />}</span>
                    {p.label}
                  </li>
                );
              })}
            </ol>
            <p className="nc-progress-note">Adonis keeps going if you leave the editor. You get a notification when the {carousel ? "slides are" : "post is"} ready.</p>
          </section>
        ) : (
          <section className="nc-card">
            <label htmlFor="topic" className="nc-label">
              What&rsquo;s this post about?
            </label>
            <textarea
              id="topic"
              className="nc-input"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void startWithAi();
                }
              }}
              rows={3}
              placeholder="e.g. why over-35s should lift weights, for people who think it's too late to start"
            />
            <div className="nc-bar">
              <div className="nc-format" role="group" aria-label="Format">
                <button type="button" aria-pressed={carousel} className={carousel ? "is-on" : undefined} onClick={() => setKind("carousel")}>
                  <GalleryHorizontal size={15} /> Carousel
                </button>
                <button type="button" aria-pressed={!carousel} className={!carousel ? "is-on" : undefined} onClick={() => setKind("single")}>
                  <Square size={15} /> Single post
                </button>
              </div>
              {carousel && (
                <select aria-label="Number of slides" className="nc-slides" value={slides} onChange={(e) => setSlides(Number(e.target.value))}>
                  {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <option key={n} value={n}>
                      {n} slides
                    </option>
                  ))}
                </select>
              )}
              <span className="nc-bar-gap" />
              <button type="button" className="nc-self" onClick={startManually} disabled={working}>
                <PenLine size={14} /> I&rsquo;ll write it myself
              </button>
              <button type="button" className="btn btn--primary btn--md nc-go" onClick={startWithAi} disabled={working || !ready} title={ready ? "Press Enter to write" : "Say what the post is about first"}>
                <Sparkles size={15} /> Write it with Adonis
              </button>
            </div>
          </section>
        )}

        {error && <div className="nc-error" role="alert">{error}</div>}

        {!phase && (
          <>
            <PostIdeas onPick={(t) => setTopic(t)} />
            <section className="nc-section">
              <h2 className="nc-h2">Or start from a template</h2>
              <TemplateGallery
                previewCount={4}
                library={props.library}
                brand={props.brand}
                defaultHeadingFontId={props.defaultHeadingFontId}
                defaultBodyFontId={props.defaultBodyFontId}
                logoUrl={props.logoUrl}
                accentColor={props.accentColor}
              />
            </section>
          </>
        )}
      </div>

      <PostPreview
        topic={topic}
        carousel={carousel}
        slides={slides}
        library={props.library}
        brand={props.brand}
        businessName={props.brand?.businessName ?? ""}
        defaultHeadingFontId={props.defaultHeadingFontId}
        defaultBodyFontId={props.defaultBodyFontId}
        logoUrl={props.logoUrl}
        accentColor={props.accentColor}
      />
    </div>
  );
}
