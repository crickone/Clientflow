"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ImagePlus, Loader2, RotateCcw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Input";
import {
  DEFAULT_HEADING_FONT,
  HEADING_FONTS,
  type ThemeConfig,
} from "@/lib/theme";
import { resetThemeAction, saveThemeAction } from "@/app/settings/appearance/actions";

/** Live-preview just the heading font on the document root (inline → wins over
 *  the injected <style>). Colours are the app light/dark mode now — toggled from
 *  the sidebar, not editable here — so we never touch the palette from here. */
function applyLiveFont(headingFont: string) {
  const f = HEADING_FONTS.find((x) => x.id === headingFont) ?? HEADING_FONTS[0];
  document.documentElement.style.setProperty("--font-heading", `var(${f.cssVar})`);
}

export function AppearanceView({
  theme,
  hasLogo,
  businessName,
}: {
  theme: ThemeConfig;
  hasLogo: boolean;
  businessName: string;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<ThemeConfig>(theme);
  const [draft, setDraft] = useState<ThemeConfig>(theme);
  const [pending, start] = useTransition();

  const savedRef = useRef(saved);
  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);

  // Live-preview just the heading font while editing…
  useEffect(() => {
    applyLiveFont(draft.headingFont);
  }, [draft.headingFont]);
  // …and revert to the last saved font if the user leaves without saving.
  useEffect(() => {
    return () => applyLiveFont(savedRef.current.headingFont);
  }, []);

  const dirty = draft.headingFont !== saved.headingFont;

  const save = () => {
    start(async () => {
      // bg/accent are carried through unchanged — the colour picker was retired
      // (light/dark is the sidebar toggle); only the heading font is editable here.
      const res = await saveThemeAction({
        bg: saved.bg,
        accent: saved.accent,
        headingFont: draft.headingFont,
      });
      if (res.ok) {
        setSaved(draft);
        toast.success("Heading font saved.");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  const reset = () => {
    start(async () => {
      const res = await resetThemeAction();
      if (res.ok) {
        // Only the heading font resets; the tenant's bg/accent (brand) stay.
        setDraft((d) => ({ ...d, headingFont: DEFAULT_HEADING_FONT }));
        setSaved((s) => ({ ...s, headingFont: DEFAULT_HEADING_FONT }));
        toast.success("Heading font reset.");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* ── Heading font ─────────────────────────────────────────── */}
      <Section title="Heading font">
        <div style={{ display: "grid", gap: 18 }}>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            Choose the display font used for headings across the app. Light and dark mode
            are toggled from the sun/moon button at the bottom of the sidebar.
          </div>

          {/* heading font */}
          <div>
            <Label>Heading font</Label>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                gap: 10,
                marginTop: 8,
              }}
            >
              {HEADING_FONTS.map((f) => {
                const active = draft.headingFont === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, headingFont: f.id }))}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: "var(--radius)",
                      border: active ? "1px solid var(--accent)" : "1px solid var(--hairline)",
                      background: active ? "var(--accent-soft)" : "var(--surface-1)",
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: `var(${f.cssVar}), sans-serif`,
                        fontSize: 22,
                        lineHeight: 1.1,
                        textTransform: "uppercase",
                        color: "var(--text-primary)",
                      }}
                    >
                      Aa
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        marginTop: 4,
                        color: active ? "var(--accent-ink)" : "var(--text-tertiary)",
                        fontFamily: "var(--font-mono), monospace",
                      }}
                    >
                      {f.label}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <ThemePreview businessName={businessName} />

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Button onClick={save} disabled={!dirty || pending}>
              {pending ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
              {pending ? "Saving…" : "Save font"}
            </Button>
            <Button variant="outline" onClick={reset} disabled={pending}>
              <RotateCcw size={14} />
              Reset font
            </Button>
          </div>
        </div>
      </Section>

      {/* ── Logo ─────────────────────────────────────────────────── */}
      <LogoManager hasLogo={hasLogo} />
    </div>
  );
}

// ── live preview mock ─────────────────────────────────────────────────────────

function ThemePreview({ businessName }: { businessName: string }) {
  return (
    <div>
      <Label>Preview</Label>
      <div
        style={{
          marginTop: 8,
          display: "flex",
          borderRadius: "var(--radius)",
          border: "1px solid var(--hairline)",
          overflow: "hidden",
          background: "var(--bg)",
          minHeight: 150,
        }}
      >
        {/* mini sidebar */}
        <div
          style={{
            width: 120,
            background: "var(--surface-1)",
            borderRight: "1px solid var(--hairline)",
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-heading), sans-serif",
              fontSize: 13,
              textTransform: "uppercase",
              color: "var(--text-primary)",
            }}
          >
            {businessName?.slice(0, 14) || "AdonisAgent"}
          </div>
          <div style={{ height: 1, background: "var(--hairline)", margin: "2px 0" }} />
          <div style={{ ...navPill, background: "var(--accent-soft)", color: "var(--accent-ink)" }}>
            Dashboard
          </div>
          <div style={navPill}>Timetable</div>
          <div style={navPill}>Clients</div>
        </div>

        {/* mini content */}
        <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              background: "var(--surface-1)",
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius)",
              padding: 14,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>Card title</div>
            <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 4 }}>
              Secondary text sits on the surface.
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span
              style={{
                background: "var(--accent)",
                color: "var(--accent-contrast)",
                fontSize: 12.5,
                fontWeight: 500,
                padding: "7px 14px",
                borderRadius: "var(--radius)",
              }}
            >
              Primary action
            </span>
            <span style={{ color: "var(--accent-ink)", fontSize: 12.5 }}>Accent link</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const navPill: React.CSSProperties = {
  fontSize: 11.5,
  color: "var(--text-secondary)",
  padding: "5px 8px",
  borderRadius: 6,
};

// ── logo manager (reuses /api/branding/logo) ──────────────────────────────────

function LogoManager({ hasLogo }: { hasLogo: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cacheKey, setCacheKey] = useState(() => String(Date.now()));

  async function uploadFile(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      setError("Logo must be under 5 MB.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/branding/logo", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Upload failed.");
      setCacheKey(String(Date.now()));
      toast.success("Logo updated.");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Upload failed.";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function removeLogo() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/branding/logo", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not remove logo.");
      toast.success("Logo removed.");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not remove logo.";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Logo">
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
          Your business logo, shown at the top of the sidebar (and on Content Studio intro/outro
          cards). When no logo is set, the AdonisAgent wordmark is used.
        </div>

        {/* preview on the actual sidebar surface */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            borderRadius: "var(--radius)",
            border: "1px dashed var(--hairline-strong)",
            background: "var(--surface-1)",
            minHeight: 120,
          }}
        >
          {hasLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/branding/logo?v=${cacheKey}`}
              alt="Business logo"
              style={{ maxHeight: 80, maxWidth: "100%", objectFit: "contain" }}
            />
          ) : (
            <div style={{ color: "var(--text-tertiary)", fontSize: 13, textAlign: "center" }}>
              <ImagePlus size={26} style={{ marginBottom: 8, opacity: 0.6 }} />
              <div>No logo uploaded yet.</div>
            </div>
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadFile(f);
            e.target.value = "";
          }}
        />

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload size={14} />
            {hasLogo ? "Replace logo" : "Upload logo"}
          </Button>
          {hasLogo && (
            <Button type="button" variant="outline" onClick={removeLogo} disabled={busy}>
              <Trash2 size={14} />
              Remove
            </Button>
          )}
        </div>

        {error && <div style={{ color: "#dc2626", fontSize: 13 }}>{error}</div>}

        <div style={{ fontSize: 12, color: "var(--text-tertiary)", lineHeight: 1.6 }}>
          <strong>Tips:</strong> a transparent PNG (or SVG-flat PNG) works best so it sits cleanly on
          the sidebar surface. Square or horizontal logos look best. PNG / JPG / WEBP, max 5 MB.
        </div>
      </div>
    </Section>
  );
}

// ── shared section shell ──────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--bg)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        padding: 22,
        boxShadow: "var(--shadow-1)",
      }}
    >
      <Label>{title}</Label>
      <div style={{ marginTop: 8 }}>{children}</div>
    </div>
  );
}
