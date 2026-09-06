"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, Loader2, Monitor, Smartphone, Tablet, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Tooltip } from "@/components/ui/Tooltip";
import { Inspector } from "@/components/cms/studio/Inspector";
import { ScreensPanel } from "@/components/cms/studio/ScreensPanel";
import { MediaDrawer, type MediaRow } from "@/components/cms/studio/MediaDrawer";
import type { SelectionPayload } from "@/components/cms/StudioCanvas";
import {
  saveDraftAction,
  publishDraftAction,
  discardDraftAction,
} from "@/app/cms/[siteSlug]/studio/actions";

const DEVICES = {
  desktop: { icon: Monitor, w: "100%" },
  tablet: { icon: Tablet, w: "820px" },
  mobile: { icon: Smartphone, w: "390px" },
} as const;
type Device = keyof typeof DEVICES;

/**
 * The Studio: screens rail | canvas | inspector.
 *
 * Edits autosave to the page's DRAFT; the live site changes only on Publish.
 * The canvas is an iframe on the site's own public route (?cmsedit=1), talking
 * over postMessage — see StudioCanvas for the protocol.
 */
export function StudioShell({
  siteSlug,
  pages,
  initialPath,
  initialDraftPaths,
}: {
  siteSlug: string;
  pages: { path: string; title: string }[];
  initialPath: string;
  initialDraftPaths: string[];
}) {
  const confirm = useConfirm();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [path, setPath] = useState(initialPath);
  const [draftPaths, setDraftPaths] = useState<string[]>(initialDraftPaths);
  const [device, setDevice] = useState<Device>("desktop");
  const [selection, setSelection] = useState<SelectionPayload | null>(null);
  const [libOpen, setLibOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const hasDraft = draftPaths.includes(path);
  // Gates both destructive/terminal actions: while any one of save, publish
  // or discard is running, neither Publish nor Discard can be started, so
  // the three never overlap from the UI side (see flush()/publish()/discard()
  // below for the matching server-side ordering guarantee).
  const busy = saving || publishing || discarding;
  const src = (p: string) => `/site/${siteSlug}${p === "/" ? "" : p}?cmsedit=1`;

  const toCanvas = useCallback((msg: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(msg, "*");
  }, []);

  // --- autosave the draft ---
  // `pending` holds the content the canvas last posted via `cms:dirty`, paired
  // with the page path it belongs to — captured at QUEUE time (below), not
  // when the debounce timer fires. Reading the path only at fire time would
  // let a screen switch inside the debounce window save the old screen's
  // edits onto the new screen's draft.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ path: string; content: string } | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;

  // `inFlight` holds the promise of whatever saveDraftAction call is
  // currently on the wire (or null when none is). `pending`/`timer` only
  // ever describe work that HASN'T been dispatched yet — the moment a save
  // is sent, pending is cleared, so without this ref there is no record
  // that a write is still outstanding. Publish and Discard both need that
  // record: they must never run while a save the operator can't see the
  // end of is still able to land afterwards.
  const inFlight = useRef<Promise<void> | null>(null);

  // Sends whatever's pending right now, then waits for whatever save is now
  // in flight — the one just dispatched, or one a previous debounce fire is
  // still waiting on — to finish. Callers can rely on "flush() resolved"
  // meaning no save is outstanding.
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const p = pending.current;
    if (p) {
      pending.current = null;
      setSaving(true);
      inFlight.current = (async () => {
        try {
          const r = await saveDraftAction(siteSlug, p.path, p.content);
          if (r.ok) {
            setSavedAt(Date.now());
            setDraftPaths((prev) => (prev.includes(p.path) ? prev : [...prev, p.path]));
          } else toast.error(r.error ?? "Couldn't save the draft.");
        } finally {
          setSaving(false);
        }
      })();
    }
    const current = inFlight.current;
    if (current) {
      await current;
      // Only clear if nothing newer replaced it while we were awaiting.
      if (inFlight.current === current) inFlight.current = null;
    }
  }, [siteSlug]);

  const queueSave = useCallback(
    (content: string) => {
      pending.current = { path: pathRef.current, content };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void flush();
      }, 1200);
    },
    [flush],
  );

  // --- canvas messages ---
  // A picker token is only ever valid for the element it was minted against.
  // The canvas re-posts cms:selection to refresh the Inspector after a prop
  // edit on the SAME element (e.g. typing alt text while the picker is still
  // open) — that must not clear the token. But a genuine selection change
  // (the operator clicking a different element on the canvas) must, or a
  // stale token can silently replace the wrong image later. selectionRef
  // mirrors the last selection so incoming messages can tell the two apart
  // without changing the postMessage payload shape.
  const pendingToken = useRef<string | null>(null);
  const selectionRef = useRef<SelectionPayload | null>(null);
  useEffect(() => {
    function isSameElement(a: SelectionPayload | null, b: SelectionPayload | null) {
      if (!a || !b) return a === b;
      if (a.kind !== b.kind || a.props.tag !== b.props.tag) return false;
      if (a.breadcrumb.length !== b.breadcrumb.length) return false;
      for (let i = 0; i < a.breadcrumb.length; i++) {
        if (a.breadcrumb[i].label !== b.breadcrumb[i].label || a.breadcrumb[i].depth !== b.breadcrumb[i].depth) {
          return false;
        }
      }
      // src is never touched by cms:setProp, only by a successful pick, so
      // for images it's the strongest available signal that this is still
      // the same element rather than a sibling with an identical shape.
      if (a.kind === "image" && a.props.src !== b.props.src) return false;
      return true;
    }

    function onMsg(ev: MessageEvent) {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      const d = ev.data || {};
      if (d.type === "cms:ready") {
        selectionRef.current = null;
        setSelection(null);
      } else if (d.type === "cms:dirty") {
        queueSave(String(d.content ?? ""));
      } else if (d.type === "cms:selection") {
        const next = d.kind ? (d as SelectionPayload) : null;
        if (!isSameElement(selectionRef.current, next)) pendingToken.current = null;
        selectionRef.current = next;
        setSelection(next);
      } else if (d.type === "cms:pickImage") {
        pendingToken.current = d.token;
        setLibOpen(true);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [queueSave]);

  // The sidebar's "Manage site" links and the "Sites" back-link are plain
  // next/link Links (not the internal navigate() below), so they can unmount
  // this shell while a debounced autosave is still pending. Flush it, don't
  // drop it: cancelling here would silently lose an edit the operator just
  // made. saveDraftAction is a server action and completes regardless of this
  // component being unmounted, so it's called directly rather than through
  // flush() (which updates state that no longer has anywhere to go).
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (pending.current) {
        const p = pending.current;
        pending.current = null;
        void saveDraftAction(siteSlug, p.path, p.content);
      }
    };
  }, [siteSlug]);

  const reload = useCallback(
    (p: string) => {
      setSelection(null);
      if (iframeRef.current) iframeRef.current.src = src(p);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [siteSlug],
  );

  function navigate(p: string) {
    if (p === path) return;
    // Flush rather than cancel — switching screens must not lose an edit
    // that's still sitting in the debounce window.
    void flush();
    setPath(p);
    reload(p);
  }

  async function publish() {
    // Publishing reads whatever the draft currently holds in the database, so
    // an edit still sitting in the debounce window — or one a debounce timer
    // just fired and is already waiting on a response for — has to land
    // there first. flush() now awaits that in-flight request too, not just
    // the queued-but-undispatched case.
    await flush();
    setPublishing(true);
    try {
      const r = await publishDraftAction(siteSlug, path);
      if (r.ok) {
        toast.success("Published");
        setDraftPaths((prev) => prev.filter((x) => x !== path));
        setSavedAt(null);
      } else toast.error(r.error ?? "Publish failed");
    } finally {
      setPublishing(false);
    }
  }

  async function discard() {
    if (
      !(await confirm({
        title: "Discard this draft?",
        body: "The page goes back to what visitors currently see. This can't be undone.",
        confirmLabel: "Discard",
        destructive: true,
      }))
    )
      return;
    setDiscarding(true);
    try {
      // A save still in flight (or one still sitting in the debounce window)
      // must be resolved before the delete runs, or its write can land after
      // the discard and resurrect the draft we just asked to throw away.
      // Whatever it writes doesn't matter — the delete below always runs
      // after it now, so the draft ends up gone either way.
      await flush();
      const r = await discardDraftAction(siteSlug, path);
      if (r.ok) {
        setDraftPaths((prev) => prev.filter((x) => x !== path));
        setSavedAt(null);
        reload(path);
      } else toast.error(r.error ?? "Couldn't discard the draft.");
    } finally {
      setDiscarding(false);
    }
  }

  // Note: a fourth "just-published/saved, no draft" branch (savedAt &&
  // !hasDraft, shown with a success-colored check) doesn't exist here — every
  // successful save also adds the path to draftPaths, so hasDraft is always
  // true whenever savedAt is. That state is unreachable in practice, so
  // there's nothing to render for it.
  const status = saving
    ? { icon: <Loader2 size={13} className="spin" />, text: "Saving draft…", color: "var(--text-tertiary)" }
    : hasDraft
      ? { icon: <span style={{ color: "var(--warning)" }}>●</span>, text: "Draft — not published", color: "var(--warning)" }
      : { icon: null, text: "Published", color: "var(--text-tertiary)" };

  return (
    <div style={{ display: "grid", gridTemplateRows: "52px 1fr", height: "100vh" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "0 16px",
          borderBottom: "1px solid var(--hairline)",
          background: "var(--surface-1)",
        }}
      >
        <Link
          href="/cms"
          className="nav-link"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-secondary)", fontSize: 13, padding: "5px 8px", borderRadius: 6 }}
        >
          <ArrowLeft size={16} /> Sites
        </Link>
        <strong style={{ fontSize: 14 }}>Visual editor</strong>
        <span style={{ color: "var(--text-tertiary)", fontSize: 13 }}>{path}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: status.color }}>
          {status.icon} {status.text}
        </span>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {(Object.keys(DEVICES) as Device[]).map((dv) => {
            const Icon = DEVICES[dv].icon;
            return (
              <Tooltip label={dv} key={dv}>
                <button
                  onClick={() => setDevice(dv)}
                  aria-label={dv}
                  style={{
                    border: "none",
                    background: device === dv ? "var(--surface-2)" : "transparent",
                    color: device === dv ? "var(--text-primary)" : "var(--text-tertiary)",
                    borderRadius: 6,
                    padding: 6,
                    cursor: "pointer",
                  }}
                >
                  <Icon size={16} />
                </button>
              </Tooltip>
            );
          })}
          <a
            href={`/site/${siteSlug}${path === "/" ? "" : path}`}
            target="_blank"
            rel="noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--text-secondary)" }}
          >
            View <ExternalLink size={13} />
          </a>
          {hasDraft && (
            <Button size="sm" variant="ghost" onClick={discard} disabled={busy} loading={discarding}>
              <Trash2 size={14} /> Discard draft
            </Button>
          )}
          <Button size="sm" onClick={publish} disabled={!hasDraft || busy} loading={publishing}>
            <Upload size={14} /> Publish
          </Button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 300px", minHeight: 0 }}>
        <ScreensPanel
          siteSlug={siteSlug}
          pages={pages}
          activePath={path}
          draftPaths={draftPaths}
          onNavigate={navigate}
        />

        <div
          style={{
            background: "var(--surface-2)",
            display: "grid",
            placeItems: "start center",
            overflow: "auto",
            padding: device === "desktop" ? 0 : 20,
          }}
        >
          <iframe
            ref={iframeRef}
            src={src(initialPath)}
            title="Site canvas"
            style={{
              width: DEVICES[device].w,
              height: "100%",
              minHeight: "100%",
              border: device === "desktop" ? "none" : "1px solid var(--hairline)",
              borderRadius: device === "desktop" ? 0 : 12,
              background: "#fff",
            }}
          />
        </div>

        <aside
          style={{
            borderLeft: "1px solid var(--hairline)",
            background: "var(--surface-1)",
            display: "grid",
            gridTemplateRows: libOpen ? "1fr auto" : "1fr",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <div style={{ overflowY: "auto", minHeight: 0 }}>
            <Inspector
              selection={selection}
              onSetProp={(prop, value) => toCanvas({ type: "cms:setProp", prop, value })}
              onSelectAncestor={(depth) => toCanvas({ type: "cms:selectAncestor", depth })}
              onReplaceImage={() => toCanvas({ type: "cms:pickImageRequest" })}
            />
          </div>
          <MediaDrawer
            open={libOpen}
            onClose={() => {
              setLibOpen(false);
              pendingToken.current = null;
            }}
            onPick={(m: MediaRow) => {
              if (pendingToken.current) {
                toCanvas({ type: "cms:setImage", token: pendingToken.current, src: m.url, alt: m.alt });
                pendingToken.current = null;
              }
              setLibOpen(false);
            }}
            onDragStart={(m) => toCanvas({ type: "cms:dragStart", asset: { id: m.id, url: m.url, alt: m.alt } })}
            onDragEnd={() => toCanvas({ type: "cms:dragEnd" })}
          />
        </aside>
      </div>
    </div>
  );
}
