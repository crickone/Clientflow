"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ImagePlus, Loader2, RotateCcw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Input";
import {
  DEFAULT_THEME,
  HEADING_FONTS,
  isHexColor,
  resolveThemeVars,
  THEME_PRESETS,
  type ThemeConfig,
} from "@/lib/theme";
import { resetThemeAction, saveThemeAction } from "@/app/settings/appearance/actions";

/** Apply a resolved palette to the live document root (inline → wins over the injected <style>). */
function applyLive(cfg: ThemeConfig) {
  const root = document.documentElement;
  for (const [k, v] of resolveThemeVars(cfg)) {
    if (k === "color-scheme") root.style.colorScheme = v;
    else root.style.setProperty(k, v);
  }
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

  // Live-preview the draft across the whole app while editing…
  useEffect(() => {
    applyLive(draft);
  }, [draft]);
  // …and revert to the last saved theme if the user leaves without saving.
  useEffect(() => {
    return () => applyLive(savedRef.current);
  }, []);

  const dirty =
    draft.bg !== saved.bg ||
    draft.accent !== saved.accent ||
    draft.headingFont !== saved.headingFont;

  const save = () => {
    if (!isHexColor(draft.bg) || !isHexColor(draft.accent)) {
      toast.error("Enter valid hex colours (e.g. #0c0d10).");
      return;
    }
    start(async () => {
      const res = await saveThemeAction(draft);
      if (res.ok) {
        setSaved(draft);
        toast.success("Theme saved.");
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
        setDraft(DEFAULT_THEME);
        setSaved(DEFAULT_THEME);
        toast.success("Theme reset to default.");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* ── Theme ─────────────────────────────────────────────────── */}
      <Section title="Theme">
        <div style={{ display: "grid", gap: 18 }}>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            Pick a page background and an accent colour. The rest of the palette — surfaces, text,
            borders — is derived automatically so the whole app stays coherent. Changes preview live;
            click <strong>Save theme</strong> to keep them.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <ColorField
              label="Background"
              value={draft.bg}
              onChange={(bg) => setDraft((d) => ({ ...d, bg }))}
            />
            <ColorField
              label="Accent"
              value={draft.accent}
              onChange={(accent) => setDraft((d) => ({ ...d, accent }))}
            />
          </div>

          {/* presets */}
          <div>
            <Label>Presets</Label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
              {THEME_PRESETS.map((p) => {
                const active = p.theme.bg === draft.bg && p.theme.accent === draft.accent;
                return (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, ...p.theme }))}
                    title={p.name}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 10px 6px 8px",
                      borderRadius: "var(--radius)",
                      border: active ? "1px solid var(--accent)" : "1px solid var(--hairline)",
                      background: active ? "var(--accent-soft)" : "transparent",
                      cursor: "pointer",
                      color: "var(--text-secondary)",
                      fontSize: 12,
                    }}
                  >
                    <span style={{ display: "inline-flex" }}>
                      <Swatch color={p.theme.bg} />
                      <Swatch color={p.theme.accent} style={{ marginLeft: -6 }} />
                    </span>
                    {p.name}
                  </button>
                );
              })}
            </div>
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
              {pending ? "Saving…" : "Save theme"}
            </Button>
            <Button variant="outline" onClick={reset} disabled={pending}>
              <RotateCcw size={14} />
              Reset to default
            </Button>
          </div>
        </div>
      </Section>

      {/* ── Logo ─────────────────────────────────────────────────── */}
      <LogoManager hasLogo={hasLogo} />
    </div>
  );
}

// ── colour field ──────────────────────────────────────────────────────────────

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const safe = isHexColor(value) ? value : "#000000";
  return (
    <div>
      <Label>{label}</Label>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginTop: 6,
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius)",
          padding: 6,
          background: "var(--surface-1)",
        }}
      >
        <input
          type="color"
          value={safe}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} colour`}
          style={{
            width: 42,
            height: 34,
            border: "none",
            background: "transparent",
            padding: 0,
            cursor: "pointer",
          }}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          spellCheck={false}
          style={{
            flex: 1,
            minWidth: 0,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--text-primary)",
            fontFamily: "var(--font-mono), monospace",
            fontSize: 13,
          }}
        />
      </div>
    </div>
  );
}

function Swatch({ color, style }: { color: string; style?: React.CSSProperties }) {
  return (
    <span
      style={{
        width: 16,
        height: 16,
        borderRadius: "50%",
        background: color,
        border: "1px solid rgba(255,255,255,0.25)",
        display: "inline-block",
        ...style,
      }}
    />
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
                color: "#fff",
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
          accept="image/png,image/jpeg,image/webp"
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
