"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { setBodyScanConsentAction } from "@/app/app/actions";

/** Turn body scans on in the app, or off again. */
export function BodyScanConsent({ on }: { on: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function set(next: boolean) {
    start(async () => {
      await setBodyScanConsentAction(next);
      router.refresh();
    });
  }

  if (on) {
    return (
      <button
        type="button"
        onClick={() => set(false)}
        disabled={pending}
        style={{ background: "none", border: 0, padding: "10px 0", color: "var(--text-tertiary)", fontSize: 13, textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer", font: "inherit" }}
      >
        Stop showing my scans in the app
      </button>
    );
  }
  return (
    <Button onClick={() => set(true)} loading={pending} style={{ width: "100%" }}>
      Show my scans
    </Button>
  );
}
