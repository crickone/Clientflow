"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/Button";

/**
 * Copies a campaign asset's raw body text to the clipboard — used on the
 * campaign hub detail page (/marketing/campaigns/[id]) for the three asset
 * kinds with no external "real home" to link to instead (offer / ad_copy /
 * video_script — see materialiseAsset, @/lib/campaigns/materialise, which
 * returns null for these by design). Mirrors the flash-to-checkmark pattern
 * already used elsewhere in this app (DomainConnectCard's CopyCell,
 * ImageDesigner's copyCaption, BlogEditor's copyToClipboard) — kept as its
 * own tiny client component here since the detail page itself is a server
 * component and navigator.clipboard needs a client boundary.
 */
export function CopyAssetButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (permissions/non-secure context) — fail silently,
      // same graceful degradation every other copy button in this app uses.
    }
  }

  return (
    <Button type="button" variant="ghost" size="sm" onClick={copy}>
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}
