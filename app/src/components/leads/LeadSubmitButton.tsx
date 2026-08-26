"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/Button";

/** Submit button for the Add-lead form (`/leads/new`) — reads pending state
 *  from the nearest ancestor <form action={...}> via useFormStatus, same
 *  idiom as AddSiteForm/NewPageForm/ClientForm's SubmitButton. Disables on
 *  submit (blocks a double-submit) and swaps its label so the click is
 *  visibly working while createManualLeadAction runs. */
export function LeadSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Adding…" : "Add lead"}
    </Button>
  );
}
