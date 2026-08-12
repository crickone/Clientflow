"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Trash2, ImagePlus, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Input";
import { FONT_OPTIONS } from "@/lib/image/fonts";
import { saveBrandFontsAction } from "@/app/settings/branding/actions";

export function BrandingForm({
  hasLogo,
  filename,
  headingFontId,
  bodyFontId,
}: {
  hasLogo: boolean;
  filename: string | null;
  headingFontId: string;
  bodyFontId: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heading, setHeading] = useState(headingFontId);
  const [body, setBody] = useState(bodyFontId);
  const [savingFonts, setSavingFonts] = useState(false);
  const fontsDirty = heading !== headingFontId || body !== bodyFontId;

  async function saveFonts() {
    setSavingFonts(true);
    try {
      const res = await saveBrandFontsAction({ heading, body });
      if (res.ok) {
        toast.success("Content fonts saved");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingFonts(false);
    }
  }
  // Bust the <img> cache when a new file is uploaded — the URL stays the
  // same so we tack a query string on.
  const [cacheKey, setCacheKey] = useState<string>(() =>
    String(Date.now()),
  );

  useEffect(() => {
    setCacheKey(String(Date.now()));
  }, [filename]);

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
      const res = await fetch("/api/branding/logo", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Upload failed.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
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
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Could not remove logo.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove logo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <Section title="Business logo">
        <div style={{ display: "grid", gap: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
              borderRadius: "var(--radius)",
              border: "1px dashed var(--hairline-strong)",
              background: "#0a0a0a",
              minHeight: 180,
            }}
          >
            {hasLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/branding/logo?v=${cacheKey}`}
                alt="Business logo"
                style={{
                  maxHeight: 160,
                  maxWidth: "100%",
                  objectFit: "contain",
                }}
              />
            ) : (
              <div
                style={{
                  color: "var(--text-tertiary)",
                  fontSize: 13,
                  textAlign: "center",
                }}
              >
                <ImagePlus
                  size={28}
                  style={{ marginBottom: 8, opacity: 0.6 }}
                />
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
            <Button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              <Upload size={14} />
              {hasLogo ? "Replace logo" : "Upload logo"}
            </Button>
            {hasLogo && (
              <Button
                type="button"
                variant="outline"
                onClick={removeLogo}
                disabled={busy}
              >
                <Trash2 size={14} />
                Remove
              </Button>
            )}
          </div>

          {error && (
            <div style={{ color: "#dc2626", fontSize: 13 }}>{error}</div>
          )}

          <div
            style={{
              fontSize: 12,
              color: "var(--text-tertiary)",
              lineHeight: 1.6,
            }}
          >
            <strong>Tips:</strong> use a transparent PNG (or a logo on the same
            dark colour as the cards) — the intro/outro background is near-black.
            Square or horizontal logos work best. Max 5 MB. The next Content
            Studio render with intro/outro cards enabled picks up the new logo
            automatically.
          </div>
        </div>
      </Section>

      <Section title="Content fonts">
        <div style={{ display: "grid", gap: 16 }}>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-secondary)",
              lineHeight: 1.6,
            }}
          >
            The default heading and body fonts for your Content Studio designs.
            New designs use these, and you can still override the font on any
            individual slide.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <Label htmlFor="brand-heading-font">Heading font</Label>
              <FontSelect
                id="brand-heading-font"
                value={heading}
                onChange={setHeading}
                options={FONT_OPTIONS.filter((f) => f.forHeading !== false)}
              />
            </div>
            <div>
              <Label htmlFor="brand-body-font">Body font</Label>
              <FontSelect
                id="brand-body-font"
                value={body}
                onChange={setBody}
                options={FONT_OPTIONS.filter((f) => f.forBody !== false)}
              />
            </div>
          </div>
          <div>
            <Button
              type="button"
              onClick={saveFonts}
              disabled={!fontsDirty || savingFonts}
            >
              {savingFonts ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <Check size={14} />
              )}
              {savingFonts ? "Saving…" : "Save fonts"}
            </Button>
          </div>
        </div>
      </Section>
    </div>
  );
}

function FontSelect({
  id,
  value,
  onChange,
  options,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; name: string }[];
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        background: "var(--bg)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        padding: "10px 14px",
        color: "var(--text-primary)",
        fontSize: 14,
        fontFamily: "inherit",
        cursor: "pointer",
      }}
    >
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.name}
        </option>
      ))}
    </select>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
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
