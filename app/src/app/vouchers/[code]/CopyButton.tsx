"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

import { Button } from "@/components/ui/Button";

export function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked: nothing to do.
    }
  };

  return (
    <Button type="button" variant="secondary" size="sm" onClick={onClick}>
      <Copy size={14} />
      {copied ? "Copied" : "Copy code"}
    </Button>
  );
}
