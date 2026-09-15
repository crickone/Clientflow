"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  addWatch,
  decideOutcome,
  readWatches,
  removeWatch,
  type GenerationWatch,
} from "@/lib/content-studio/generationWatch";

/**
 * Tells the operator when a detached carousel generation has finished, wherever
 * they are in the app.
 *
 * WHY IT LIVES IN THE SHELL. Generating a carousel is a detached server run,
 * and the editor explicitly invites the operator to leave the page while it
 * works. ImageDesigner's own poll unmounts the moment they do, so nothing was
 * left to tell them it was done. A watcher that notifies you about a page you
 * have LEFT has to be mounted above the page — hence the app shell, plus a
 * localStorage watch list so it also survives a reload.
 *
 * It renders nothing. It is mounted on every authenticated page, so the two
 * rules it must never break are: cost nothing when idle (no watches means no
 * timer and no requests at all), and never throw into the shell.
 *
 * INDEPENDENT OF THE EDITOR'S POLL. When the operator is sitting on the design
 * page, ImageDesigner polls the same GET route and repaints the slides. This
 * watcher shares no state with it, dispatches nothing into it, and only ever
 * issues the same read-only GET — so the two cannot fight. The visible overlap
 * is intentional and harmless: the editor shows the slides arriving, this shows
 * a toast saying they did.
 */

/** Considerate: a completion noticed 5s late is still a completion. */
const POLL_MS = 5000;

/**
 * Fired on window when a watch is added, so the shell's watcher starts polling
 * immediately instead of waiting for the next mount. The native "storage" event
 * only fires in OTHER tabs, which is exactly the tab we need to reach here.
 */
const WATCH_ADDED_EVENT = "content-studio:generation-watch-added";

export function GenerationWatcher() {
  const router = useRouter();
  // The list lives in localStorage; this mirror exists only so the effect knows
  // whether to run a timer at all. It is read after mount, never during render,
  // so the server render stays deterministic.
  const [watchCount, setWatchCount] = useState(0);

  // The router changes identity on navigation. Reading it through a ref keeps
  // it out of the poll effect's dependencies, so navigating does NOT tear the
  // timer down and restart it mid-run.
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    // Pick the list up on mount (covers a reload mid-generation) and whenever
    // another tab, or the Generate button in this one, changes it.
    const sync = () => setWatchCount(readWatches().length);
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(WATCH_ADDED_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(WATCH_ADDED_EVENT, sync);
    };
  }, []);

  useEffect(() => {
    // Nothing to wait on: no timer, no requests. This is the idle case on
    // almost every page load, and it must cost exactly nothing.
    if (watchCount === 0) return;
    let stopped = false;

    const tick = async () => {
      const watches = readWatches();
      if (watches.length === 0) {
        if (!stopped) setWatchCount(0);
        return;
      }
      for (const watch of watches) {
        if (stopped) return;
        const status = await fetchStatus(watch.id);
        const outcome = decideOutcome(watch, status, Date.now());
        if (outcome.kind === "running") continue;
        // CLAIM BEFORE NOTIFYING. Two tabs both running this watcher both see
        // the same completion. removeWatch reports whether THIS call is the one
        // that removed the entry, so only the tab that won notifies.
        //
        // Residual risk, accepted: localStorage is not atomic across tabs, so
        // two tabs whose read-modify-write interleave inside the same few
        // milliseconds can both believe they claimed it and both notify. The
        // window is tiny (the ticks would have to land together), the cost is
        // one duplicate toast, and closing it properly needs a lock protocol
        // that is not worth it for a notification.
        const claimed = removeWatch(watch.id);
        if (!claimed) continue;
        if (outcome.kind === "expired") {
          // Say nothing. We do not know whether it finished; a run usually ends
          // up here because the server restarted under it. Claiming either
          // outcome would be a lie, and the design page shows the truth.
          continue;
        }
        if (outcome.kind === "done") notifyDone(watch, routerRef.current);
        else notifyFailed(watch, outcome.error, routerRef.current);
      }
      if (!stopped) setWatchCount(readWatches().length);
    };

    const iv = window.setInterval(tick, POLL_MS);
    // One immediate tick, so a reload landing on an already-finished run says
    // so straight away instead of after a first empty interval.
    void tick();
    return () => {
      stopped = true;
      window.clearInterval(iv);
    };
  }, [watchCount]);

  return null;
}

/**
 * Read one design's generation status. Any failure returns null, which
 * decideOutcome reads as "still running" — a dropped request is not a result,
 * and the TTL ends a watch whose design is genuinely gone.
 */
async function fetchStatus(id: number) {
  try {
    const res = await fetch(`/api/content-studio/carousels/${id}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json?.ok || !json.carousel) return null;
    return {
      generationStatus: json.carousel.generationStatus ?? null,
      generationError: json.carousel.generationError ?? null,
    };
  } catch {
    return null;
  }
}

function designHref(id: number) {
  return `/content-studio/images/${id}`;
}

/** The name is the notification's whole subject line, so give it a fallback. */
function labelFor(watch: GenerationWatch) {
  return watch.name.trim() || "Your design";
}

function notifyDone(watch: GenerationWatch, router: ReturnType<typeof useRouter>) {
  const href = designHref(watch.id);
  toast.success(`${labelFor(watch)} is ready`, {
    description: "Adonis finished writing the slides.",
    duration: 10_000,
    action: { label: "Open", onClick: () => router.push(href) },
  });
  showBrowserNotification(
    `${labelFor(watch)} is ready`,
    "Adonis finished writing the slides.",
    href,
  );
}

function notifyFailed(
  watch: GenerationWatch,
  error: string | null,
  router: ReturnType<typeof useRouter>,
) {
  const href = designHref(watch.id);
  const detail = error ?? "No reason was recorded. Open it and generate again.";
  toast.error(`Writing ${labelFor(watch)} failed`, {
    description: detail,
    duration: 12_000,
    action: { label: "Open", onClick: () => router.push(href) },
  });
  showBrowserNotification(`Writing ${labelFor(watch)} failed`, detail, href);
}

/**
 * An OS-level notification, but ONLY when the tab is hidden.
 *
 * If the operator is looking at the app, the toast has already told them and a
 * second popup outside the window is pure noise. The whole point of this path
 * is reaching them when they are somewhere else.
 *
 * Everything here is best-effort: no API (Safari in some contexts, an insecure
 * origin), permission denied, or the constructor throwing all leave the toast
 * as the only channel, which is a complete experience on its own.
 */
function showBrowserNotification(title: string, body: string, href: string) {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    if (typeof document !== "undefined" && !document.hidden) return;
    const n = new Notification(title, { body, tag: href });
    n.onclick = () => {
      try {
        window.focus();
      } catch {}
      // A hard navigation, not router.push: the click arrives from the OS with
      // the tab in the background, where a client-side push has repeatedly
      // proven flaky. Landing on the design is what matters, not how.
      window.location.href = href;
      n.close();
    };
  } catch {
    // Never let a notification take the page with it.
  }
}

/**
 * Start watching a design, from wherever a run is started.
 *
 * Permission is requested HERE, and only here, because this is called straight
 * after the operator clicked Generate — the gesture that makes an OS-level
 * notification request expected rather than an ambush. Never on page load.
 * A denial is fine: the toast path is unaffected.
 */
export function watchGeneration(id: number, name: string) {
  try {
    addWatch({ id, name, startedAt: Date.now() });
    window.dispatchEvent(new Event(WATCH_ADDED_EVENT));
  } catch {
    // A watch is a nicety on top of a run that is already underway. Losing it
    // must never surface as an error on the Generate button.
  }
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "default") return;
    // Fire and forget. Older Safari passes a callback instead of returning a
    // promise, so guard the .catch rather than assuming a thenable.
    const result = Notification.requestPermission();
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch {}
}
