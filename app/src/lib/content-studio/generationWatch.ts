/**
 * The list of design generations THIS BROWSER is waiting on.
 *
 * Generating a carousel is a detached server run: the editor tells the operator
 * "it keeps going if you leave this page", and they do leave — at which point
 * the only progress indicator in the app (ImageDesigner's poll) unmounts with
 * the page and nothing ever tells them it finished.
 *
 * So the watch list cannot live in the page. It lives here, in localStorage, so
 * a watcher mounted in the app shell can survive navigation AND a reload and
 * still know what it is waiting for.
 *
 * Split of concerns, deliberately: this module owns the LIST and the DECISION
 * (is this entry finished, failed, or still running?) and both are pure enough
 * to test in node. The fetching and the notifying live in the client component
 * that uses it.
 *
 * Every storage access is wrapped: a private window, blocked site data, or a
 * browser with storage disabled THROWS on access rather than returning null.
 * A notification is a convenience, never something the app depends on, so every
 * failure here degrades to "no watch, no notification" and never to an
 * exception thrown into the shell that renders every authenticated page.
 */

/** One generation we are waiting on. */
export type GenerationWatch = {
  /** The design (carousel) id — also what /content-studio/images/<id> keys on. */
  id: number;
  /** The design's name at the time it started, for the notification copy. */
  name: string;
  /** Epoch ms when the run was started, for the expiry rule below. */
  startedAt: number;
};

/**
 * What a freshly-fetched status means for a watched entry.
 *
 * "expired" is its own outcome rather than a silent drop so the caller can stop
 * polling an entry without pretending it succeeded or failed — we genuinely do
 * not know which.
 */
export type WatchOutcome =
  | { kind: "running" }
  | { kind: "done" }
  | { kind: "failed"; error: string | null }
  | { kind: "expired" };

/** The shape of the status the carousel GET route returns for a design. */
export type FetchedGenerationStatus = {
  /** "writing" | "failed" | null — see lib/image/carousels.ts. */
  generationStatus?: string | null;
  generationError?: string | null;
};

/**
 * Give up on a watch after 30 minutes. A detached run dies with the server
 * (a deploy swapping the container mid-run is the usual one) and leaves the
 * row on "writing" forever — without this, every tab that ever started a
 * generation would poll that id until the operator cleared their site data.
 */
export const WATCH_TTL_MS = 30 * 60 * 1000;

/** Namespaced so it cannot collide with the other per-browser prefs we store. */
export const WATCH_STORAGE_KEY = "content-studio:generation-watch";

/** The slice of Storage we use — narrow, so a test can hand in a fake. */
export type WatchStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type WatchOptions = {
  /** Defaults to window.localStorage; null/absent means "no persistence". */
  storage?: WatchStorage | null;
  /** Injectable clock, so the expiry rule is testable without waiting. */
  now?: number;
};

function resolveStorage(storage?: WatchStorage | null): WatchStorage | null {
  if (storage !== undefined) return storage;
  try {
    // Reading the property itself can throw when site data is blocked, which
    // is why this is inside the try and not just the getItem call below.
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Accepts only entries we could actually act on; anything else is dropped. */
function parseEntry(raw: unknown): GenerationWatch | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const id = Number(e.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const startedAt = Number(e.startedAt);
  if (!Number.isFinite(startedAt)) return null;
  const name = typeof e.name === "string" ? e.name : "";
  return { id, name, startedAt };
}

/**
 * The watches this browser is still waiting on, expired ones already dropped.
 *
 * Returns [] for every failure mode — storage throwing, absent, holding
 * something that is not our JSON — because the only thing the caller does with
 * an empty list is nothing at all, which is exactly the right fallback.
 */
export function readWatches(opts: WatchOptions = {}): GenerationWatch[] {
  const storage = resolveStorage(opts.storage);
  if (!storage) return [];
  const now = opts.now ?? Date.now();
  let parsed: unknown;
  try {
    const raw = storage.getItem(WATCH_STORAGE_KEY);
    if (!raw) return [];
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const live: GenerationWatch[] = [];
  for (const raw of parsed) {
    const entry = parseEntry(raw);
    if (!entry) continue;
    if (isExpired(entry, now)) continue;
    live.push(entry);
  }
  return live;
}

function writeWatches(
  entries: GenerationWatch[],
  storage: WatchStorage | null,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(WATCH_STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch {
    // Quota, or storage disabled between the read and the write.
    return false;
  }
}

/**
 * Start watching a design. Re-adding an id replaces the existing entry rather
 * than duplicating it, so a second Generate on the same design restarts the
 * clock instead of leaving a stale entry that expires mid-run.
 */
export function addWatch(
  entry: GenerationWatch,
  opts: WatchOptions = {},
): GenerationWatch[] {
  const storage = resolveStorage(opts.storage);
  const now = opts.now ?? Date.now();
  const next = readWatches({ storage, now }).filter((w) => w.id !== entry.id);
  next.push(entry);
  writeWatches(next, storage);
  return next;
}

/**
 * Stop watching a design, and say whether THIS call is the one that removed it.
 *
 * That boolean is the cross-tab claim: two tabs both running the watcher both
 * see the same completion, and whichever one removes the entry is the one that
 * notifies. See the watcher component for the residual race.
 */
export function removeWatch(
  id: number,
  opts: WatchOptions = {},
): boolean {
  const storage = resolveStorage(opts.storage);
  const now = opts.now ?? Date.now();
  const current = readWatches({ storage, now });
  const next = current.filter((w) => w.id !== id);
  if (next.length === current.length) return false;
  // If the write itself fails we have not actually claimed anything — another
  // tab can still read the entry — so report the claim as lost rather than
  // notifying on a removal that did not stick.
  return writeWatches(next, storage);
}

/** Older than the TTL: the run is presumed dead, not pending. */
export function isExpired(watch: GenerationWatch, now: number): boolean {
  return now - watch.startedAt >= WATCH_TTL_MS;
}

/**
 * The whole decision, pure: given what we are waiting on and what the server
 * just said about it, is this finished, failed, still going, or too old to care?
 *
 * Expiry is checked FIRST so a run wedged on "writing" by a server restart
 * stops being polled, rather than being reported as still running forever.
 *
 * A status we do not recognise counts as done: the route returns null once a
 * run resolves, and anything else new would still mean "no longer writing".
 * Erring towards a spurious "ready" beats polling an id until it expires.
 */
export function decideOutcome(
  watch: GenerationWatch,
  status: FetchedGenerationStatus | null,
  now: number,
): WatchOutcome {
  if (isExpired(watch, now)) return { kind: "expired" };
  // No answer at all (a 404, a dropped request) is not evidence of anything —
  // keep waiting, and let the TTL end it if the design is genuinely gone.
  if (!status) return { kind: "running" };
  const value = status.generationStatus ?? null;
  if (value === "writing") return { kind: "running" };
  if (value === "failed") {
    const error =
      typeof status.generationError === "string" && status.generationError.trim()
        ? status.generationError.trim()
        : null;
    return { kind: "failed", error };
  }
  return { kind: "done" };
}
