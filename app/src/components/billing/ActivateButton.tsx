"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/Button";

/** Submit button for the activation form (`/billing/activate`). Same idiom as
 *  LeadSubmitButton: reads pending state from the nearest ancestor
 *  <form action={...}> so the click is visibly working while startCapture
 *  creates the session and redirects to the payment provider — a redirect that
 *  can take a moment, which is exactly when someone clicks twice. */
export function ActivateButton({ amount }: { amount: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="lg" loading={pending} style={{ width: "100%" }}>
      {pending ? "Opening secure payment…" : `Pay ${amount} and activate`}
    </Button>
  );
}
