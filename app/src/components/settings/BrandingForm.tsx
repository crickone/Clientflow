"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Trash2, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Input";
import { Logo } from "@/components/ui/Logo";
import { FONT_OPTIONS } from "@/lib/image/fonts";
import { THEME_MODES } from "@/lib/theme";
import { saveBrandFontsAction, saveBrandImageStyleAction } from "@/app/settings/branding/actions";
import { SaveStatus } from "./SaveStatus";
import { useAutosave } from "./useAutosave";

export function BrandingForm({
  hasLogo,
  filename,
  headingFontId,
  bodyFontId,
  imageStyle,
  imageStyleDefault,
}: {
  hasLogo: boolean;
  filename: string | null;
  headingFontId: string;
  bodyFontId: string;
  imageStyle: string;
  imageStyleDefault: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heading, setHeading] = useState(headingFontId);
  const [body, setBody] = useState(bodyFontId);
  const [style, setStyle] = useState(imageStyle);
  // True once the one-colour shape of the logo turns out not to exist.
  const [noShape, setNoShape] = useState(false);

  // Fonts and the image-style prompt save independently — they are separate
  // settings with separate failure modes, so they get their own status.
  const fontsAutosave = useAutosave({
    values: { heading, body },
    save: async (v) => {
      const res = await saveBrandFontsAction(v);
      if (!res.ok) throw new Error(res.error);
    },
  });

  const styleAutosave = useAutosave({
    values: style,
    save: async (v) => {
      const res = await saveBrandImageStyleAction({ style: v });
      if (!res.ok) throw new Error(("error" in res && res.error) || "Couldn't save.");
    },
  });
  // Bust the <img> cache when a new file is uploaded — the URL stays the
  // same so we tack a query string on.
  const [cacheKey, setCacheKey] = useState<string>(() =>
    String(Date.now()),
  );

  useEffect(() => {
    setCacheKey(String(Date.now()));
    setNoShape(false);
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
          {hasLogo ? (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                {(["light", "dark"] as const).map((mode) => (
                  <div
                    key={mode}
                    style={{
                      display: "grid",
                      placeItems: "center",
                      gap: 10,
                      padding: 24,
                      minHeight: 150,
                      borderRadius: "var(--radius)",
                      border: "1px solid var(--hairline)",
                      // The two app themes, shown side by side whatever mode the viewer is in.
                      background: THEME_MODES[mode].bg,
                    }}
                  >
                    <Logo
                      src={`/api/branding/logo?v=${cacheKey}`}
                      alt="Business logo"
                      height={56}
                      oneColour
                      colour={THEME_MODES[mode].accent}
                      onShapeMissing={() => setNoShape(true)}
                    />
                    <span style={{ fontSize: 12, color: THEME_MODES[mode].accent, opacity: 0.6 }}>{mode === "light" ? "Light mode" : "Dark mode"}</span>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 12.5, color: "var(--text-tertiary)", margin: 0, lineHeight: 1.5 }}>
                {noShape
                  ? "Shown as uploaded. Use a transparent PNG for a logo that suits light and dark."
                  : "The app shows your logo in one colour, so it reads in light and dark mode."}
              </p>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 24,
                borderRadius: "var(--radius)",
                border: "1px dashed var(--hairline-strong)",
                minHeight: 180,
                color: "var(--text-tertiary)",
                fontSize: 13,
                textAlign: "center",
              }}
            >
              <div>
                <ImagePlus size={28} style={{ marginBottom: 8, opacity: 0.6 }} />
                <div>No logo uploaded yet.</div>
              </div>
            </div>
          )}

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
              loading={busy}
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
          <SaveStatus autosave={fontsAutosave} sticky={false} />
        </div>
      </Section>

      <Section title="AI image style">
        <div style={{ display: "grid", gap: 8 }}>
          <Label htmlFor="brand-image-style">Style prompt</Label>
          <textarea
            id="brand-image-style"
            rows={3}
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder={imageStyleDefault}
            style={{
              width: "100%",
              resize: "vertical",
              font: "inherit",
              fontSize: 13,
              padding: 10,
              borderRadius: "var(--radius)",
              border: "1px solid var(--hairline)",
              background: "var(--surface-1)",
              color: "var(--text-primary)",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: "var(--text-tertiary)", marginRight: "auto" }}>
              The look-and-feel half of every AI post image prompt. Leave blank
              to use the default shown above.
            </span>
            <SaveStatus autosave={styleAutosave} sticky={false} />
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
