"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Images,
  Loader2,
  Monitor,
  Save,
  Smartphone,
  Tablet,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { savePageHtmlAction } from "@/app/cms/[siteSlug]/studio/actions";

type PageRow = { path: string; title: string };
type MediaRow = {
  id: number;
  url: string;
  originalName: string;
  alt: string | null;
};

const DEVICES = {
  desktop: { icon: Monitor, w: "100%" },
  tablet: { icon: Tablet, w: "820px" },
  mobile: { icon: Smartphone, w: "390px" },
} as const;
type Device = keyof typeof DEVICES;

export function StudioShell({
  siteSlug,
  pages,
  initialPath,
}: {
  siteSlug: string;
  pages: PageRow[];
  initialPath: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [path, setPath] = useState(initialPath);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [picker, setPicker] = useState(false);
  const [media, setMedia] = useState<MediaRow[]>([]);
  const [libOpen, setLibOpen] = useState(false);
  const [lib, setLib] = useState<MediaRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const pendingToken = useRef<string | null>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const src = (p: string) => `/site/${siteSlug}${p === "/" ? "" : p}?cmsedit=1`;
  const postToIframe = useCallback((msg: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(msg, "*");
  }, []);

  // Shared media library (global across all sites).
  const toRows = (assets: { id: number; originalName: string; alt: string | null }[]) =>
    assets.map((a) => ({
      id: a.id,
      originalName: a.originalName,
      alt: a.alt,
      url: `/library-media/${a.id}`,
    }));
  const refreshLib = useCallback(async () => {
    const res = await fetch(`/api/cms/library`).then((r) => r.json());
    setLib(toRows(res.assets || []));
  }, []);
  const openLibrary = useCallback(() => {
    setLibOpen((o) => !o);
    void refreshLib();
  }, [refreshLib]);

  const uploadFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("file", f));
      setUploading(true);
      try {
        const res = await fetch(`/api/cms/library`, { method: "POST", body: fd }).then((r) => r.json());
        if (!res.ok) toast.error(res.error ?? "Upload failed");
        else {
          toast.success(`Uploaded ${res.assets.length} image(s)`);
          await refreshLib();
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
        if (fileInput.current) fileInput.current.value = "";
      }
    },
    [refreshLib],
  );

  function onThumbDragStart(e: React.DragEvent, m: MediaRow) {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", m.url);
    postToIframe({ type: "cms:dragStart", asset: { id: m.id, url: m.url, alt: m.alt } });
  }
  function onThumbDragEnd() {
    postToIframe({ type: "cms:dragEnd" });
  }

  const save = useCallback(async () => {
    const doc = iframeRef.current?.contentDocument;
    const root = doc?.getElementById("cms-edit-root");
    if (!root) return;
    const clone = root.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("[contenteditable]").forEach((e) => e.removeAttribute("contenteditable"));
    clone.querySelectorAll("[data-cms-text]").forEach((e) => e.removeAttribute("data-cms-text"));
    clone.querySelectorAll("[data-cms-img]").forEach((e) => e.removeAttribute("data-cms-img"));
    clone.querySelectorAll(".cms-toolbar").forEach((e) => e.remove());
    const html = clone.innerHTML;
    setSaving(true);
    try {
      const r = await savePageHtmlAction(siteSlug, path, html);
      if (r.ok) {
        setDirty(false);
        setSavedAt(Date.now());
      } else {
        toast.error(r.error ?? "Save failed");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [siteSlug, path]);

  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    async function onMsg(ev: MessageEvent) {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      const d = ev.data || {};
      if (d.type === "cms:ready") {
        setPath(d.path ?? path);
        setDirty(false);
      } else if (d.type === "cms:dirty") {
        setDirty(true);
        if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
        autosaveTimer.current = setTimeout(() => saveRef.current(), 1500);
      } else if (d.type === "cms:pickImage") {
        pendingToken.current = d.token;
        const res = await fetch(`/api/cms/library`).then((r) => r.json());
        setMedia(toRows(res.assets || []));
        setPicker(true);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [siteSlug, path]);

  function navigate(p: string) {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    setDirty(false);
    setPath(p);
    if (iframeRef.current) iframeRef.current.src = src(p);
  }

  function pickImage(m: MediaRow) {
    if (pendingToken.current) {
      postToIframe({
        type: "cms:setImage",
        token: pendingToken.current,
        src: m.url,
        alt: m.alt,
      });
    }
    pendingToken.current = null;
    setPicker(false);
  }

  const status = saving
    ? { icon: <Loader2 size={13} className="spin" />, text: "Saving…", color: "var(--text-tertiary)" }
    : dirty
      ? { icon: <span style={{ color: "#d29922" }}>●</span>, text: "Unsaved", color: "#d29922" }
      : savedAt
        ? { icon: <Check size={13} />, text: "Saved", color: "#3fb950" }
        : { icon: null, text: "", color: "var(--text-tertiary)" };

  return (
    <div style={{ display: "grid", gridTemplateRows: "52px 1fr", height: "100vh" }}>
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "0 16px",
          borderBottom: "1px solid var(--hairline)",
          background: "var(--surface)",
        }}
      >
        <Link
          href={`/cms/${siteSlug}`}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-secondary)", fontSize: 13 }}
        >
          <ArrowLeft size={16} /> Exit
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
              <button
                key={dv}
                onClick={() => setDevice(dv)}
                title={dv}
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
          <button
            onClick={openLibrary}
            title="Media library"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: "1px solid var(--hairline)",
              background: libOpen ? "var(--surface-2)" : "transparent",
              color: libOpen ? "var(--text-primary)" : "var(--text-secondary)",
              borderRadius: 6,
              padding: "6px 10px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            <Images size={15} /> Media
          </button>
          <Button onClick={save} disabled={saving} size="sm">
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            Save
          </Button>
        </div>
      </div>

      {/* Body: pages panel + canvas (+ media sidebar) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `220px 1fr${libOpen ? " 300px" : ""}`,
          minHeight: 0,
        }}
      >
        <aside style={{ borderRight: "1px solid var(--hairline)", padding: 14, overflowY: "auto", background: "var(--surface)" }}>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".12em", color: "var(--text-tertiary)", marginBottom: 10 }}>
            Pages
          </div>
          <div style={{ display: "grid", gap: 2 }}>
            {pages.map((p) => (
              <button
                key={p.path}
                onClick={() => navigate(p.path)}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 13,
                  background: p.path === path ? "var(--surface-2)" : "transparent",
                  color: p.path === path ? "var(--text-primary)" : "var(--text-secondary)",
                }}
              >
                {p.title || p.path}
                <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{p.path}</div>
              </button>
            ))}
          </div>
        </aside>

        <div style={{ background: "var(--surface-2)", display: "grid", placeItems: "start center", overflow: "auto", padding: device === "desktop" ? 0 : 20 }}>
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

        {libOpen && (
          <aside
            style={{
              borderLeft: "1px solid var(--hairline)",
              background: "var(--surface)",
              display: "grid",
              gridTemplateRows: "auto auto 1fr",
              minHeight: 0,
            }}
          >
            <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--hairline)" }}>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".12em", color: "var(--text-tertiary)" }}>
                Media library
              </div>
              <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                Drag any image onto one on the page to replace it.
              </div>
            </div>
            <div style={{ padding: 12 }}>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => uploadFiles(e.target.files)}
              />
              <Button
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                size="sm"
                variant="outline"
                style={{ width: "100%" }}
              >
                {uploading ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}
                {uploading ? "Uploading…" : "Upload images"}
              </Button>
            </div>
            <div style={{ overflowY: "auto", padding: "0 12px 12px" }}>
              {lib.length === 0 ? (
                <p style={{ color: "var(--text-tertiary)", fontSize: 12, padding: "8px 2px" }}>
                  No images yet — upload some to get started.
                </p>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {lib.map((m) => (
                    <div
                      key={m.id}
                      draggable
                      onDragStart={(e) => onThumbDragStart(e, m)}
                      onDragEnd={onThumbDragEnd}
                      title={m.alt || m.originalName}
                      style={{
                        border: "1px solid var(--hairline)",
                        borderRadius: 8,
                        overflow: "hidden",
                        background: "var(--surface-2)",
                        cursor: "grab",
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={m.url}
                        alt={m.alt || m.originalName}
                        draggable={false}
                        style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block", pointerEvents: "none" }}
                      />
                      <div style={{ fontSize: 10, color: "var(--text-tertiary)", padding: "4px 6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {m.alt || m.originalName}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {picker && (
        <div
          onClick={() => setPicker(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 100, display: "grid", placeItems: "center" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "var(--surface)", borderRadius: 12, padding: 20, width: "min(720px,92vw)", maxHeight: "80vh", overflow: "auto" }}
          >
            <div style={{ fontWeight: 600, marginBottom: 12 }}>Choose an image</div>
            {media.length === 0 ? (
              <p style={{ color: "var(--text-tertiary)" }}>No media yet — upload in the Media library first.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))", gap: 10 }}>
                {media.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => pickImage(m)}
                    style={{ border: "1px solid var(--hairline)", borderRadius: 8, padding: 0, cursor: "pointer", overflow: "hidden", background: "var(--surface-2)" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.url} alt={m.originalName} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
