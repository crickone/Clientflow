"use client";

import { useFormState, useFormStatus } from "react-dom";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FieldError, Input, Label, Textarea } from "@/components/ui/Input";
import { createRequestAction, type RequestState } from "@/app/cms/actions";

const initial: RequestState = { ok: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Sending…" : "Submit request"}
    </Button>
  );
}

export function RequestSiteForm() {
  const [state, action] = useFormState(createRequestAction, initial);
  return (
    <form action={action}>
      <Card style={{ maxWidth: 560, display: "grid", gap: 16 }}>
        <div>
          <Label htmlFor="businessName">Business name</Label>
          <Input id="businessName" name="businessName" placeholder="Acme Wellness" required />
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Label htmlFor="contactName">Contact name</Label>
            <Input id="contactName" name="contactName" placeholder="Jane Doe" />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Label htmlFor="contactEmail">Contact email</Label>
            <Input id="contactEmail" name="contactEmail" type="email" placeholder="jane@acme.com" />
          </div>
        </div>
        <div>
          <Label htmlFor="notes">What do you need?</Label>
          <Textarea
            id="notes"
            name="notes"
            rows={5}
            placeholder="Goals, pages you want, style references, timeline…"
          />
        </div>
        <FieldError message={state.error} />
        <div>
          <SubmitButton />
        </div>
      </Card>
    </form>
  );
}
