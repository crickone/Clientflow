"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Activity } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { saveTrackingAction } from "@/app/cms/actions";

/**
 * The client's analytics and advertising tags for this website.
 *
 * One card, because they are one job done at one moment: before a client's
 * domain is pointed here. That day is the day their old site stops
 * reporting conversions, and nobody notices for weeks — it reads later as
 * ads quietly getting worse rather than as a launch mistake.
 *
 * It sits on the Domains screen for the same reason. An earlier version put
 * it on the site dashboard, which turned out to be a page nothing links to:
 * the Sites list goes straight into the visual editor, and the editor's
 * sidebar never goes back. The field existed, was deployed, and could not be
 * found by clicking.
 */
export function TrackingCard({
  siteSlug,
  initialPixelId,
  initialGoogleTagId,
}: {
  siteSlug: string;
  initialPixelId: string | null;
  initialGoogleTagId: string | null;
}) {
  const [pixel, setPixel] = useState(initialPixelId ?? "");
  const [google, setGoogle] = useState(initialGoogleTagId ?? "");
  const [saved, setSaved] = useState({
    pixel: initialPixelId ?? "",
    google: initialGoogleTagId ?? "",
  });
  const [pending, startTransition] = useTransition();

  const dirty = pixel.trim() !== saved.pixel.trim() || google.trim() !== saved.google.trim();

  function save() {
    startTransition(async () => {
      const res = await saveTrackingAction(siteSlug, pixel, google);
      if (res.ok) {
        setSaved({ pixel: pixel.trim(), google: google.trim() });
        toast.success("Tracking saved.");
      } else {
        toast.error(res.error ?? "Could not save that.");
      }
    });
  }

  const field = (
    label: string,
    hint: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    live: boolean,
  ) => (
    <div style={{ minWidth: 260, flex: "1 1 280px" }}>
      <label
        style={{
          display: "block",
          fontSize: 12.5,
          color: "var(--text-secondary)",
          marginBottom: 6,
        }}
      >
        {label}
        {live && (
          <span style={{ color: "var(--text-tertiary)", marginLeft: 8 }}>· live on this site</span>
        )}
      </label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        style={{ width: "100%", fontVariantNumeric: "tabular-nums" }}
      />
      <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-tertiary)" }}>{hint}</p>
    </div>
  );

  return (
    <Card style={{ padding: 20, marginTop: 20 }}>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, margin: "0 0 4px" }}>
        <Activity size={16} strokeWidth={1.8} />
        Tracking
      </h2>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-secondary)", maxWidth: "70ch" }}>
        These fire on every public page of this website, including the blog, and never inside the
        editor. Put them in place <strong>before</strong> you point the client&rsquo;s domain here —
        that is the day their old site stops reporting conversions. Leave either empty to run
        nothing.
      </p>

      <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
        {field(
          "Meta Pixel",
          "From Meta Events Manager. Digits only.",
          pixel,
          setPixel,
          "1234567890123456",
          Boolean(saved.pixel) && pixel.trim() === saved.pixel.trim(),
        )}
        {field(
          "Google tag",
          "A GTM container (GTM-…), or a GA4 tag (G-…) or Ads id (AW-…) if there is no container. With GTM, put GA4 inside the container rather than here.",
          google,
          setGoogle,
          "GTM-XXXXXXX",
          Boolean(saved.google) && google.trim() === saved.google.trim(),
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <Button onClick={save} disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save tracking"}
        </Button>
      </div>
    </Card>
  );
}
