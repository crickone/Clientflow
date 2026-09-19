"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Activity } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { saveMetaPixelAction } from "@/app/cms/actions";

/**
 * Set the client's Meta Pixel for this website.
 *
 * It lives on the site dashboard rather than under Domains, even though the
 * two only matter together: the pixel has to be in place BEFORE a domain is
 * pointed here, because the day it moves is the day the client's ads stop
 * receiving conversions from their old site. Burying it a level down makes
 * it something you remember afterwards.
 */
export function MetaPixelCard({
  siteSlug,
  initialPixelId,
}: {
  siteSlug: string;
  initialPixelId: string | null;
}) {
  const [value, setValue] = useState(initialPixelId ?? "");
  const [saved, setSaved] = useState(initialPixelId ?? "");
  const [pending, startTransition] = useTransition();

  const dirty = value.trim() !== saved.trim();

  function save() {
    startTransition(async () => {
      const res = await saveMetaPixelAction(siteSlug, value);
      if (res.ok) {
        setSaved(value.trim());
        toast.success(value.trim() ? "Meta Pixel saved." : "Meta Pixel removed.");
      } else {
        toast.error(res.error ?? "Could not save that.");
      }
    });
  }

  return (
    <Card style={{ padding: 20, marginTop: 20 }}>
      <h2 style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, margin: "0 0 4px" }}>
        <Activity size={16} strokeWidth={1.8} />
        Meta Pixel
      </h2>
      <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--text-secondary)", maxWidth: "62ch" }}>
        Fires on every public page of this website, including the blog. Put it in place before you
        point the client&rsquo;s domain here, or their ads lose conversion tracking on the day of
        the switch. Leave it empty to run no pixel at all.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Pixel ID, e.g. 1234567890123456"
          inputMode="numeric"
          aria-label="Meta Pixel ID"
          style={{ maxWidth: 280, fontVariantNumeric: "tabular-nums" }}
        />
        <Button onClick={save} disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {saved && !dirty && (
          <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>
            Live on this site
          </span>
        )}
      </div>
    </Card>
  );
}
