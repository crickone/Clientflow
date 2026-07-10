"use client";

import { useFormState, useFormStatus } from "react-dom";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FieldError, Input, Label } from "@/components/ui/Input";
import { addSiteAction, type SiteState } from "@/app/cms/actions";

const initial: SiteState = { ok: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create site"}
    </Button>
  );
}

export function AddSiteForm() {
  const [state, action] = useFormState(addSiteAction, initial);
  return (
    <form action={action}>
      <Card style={{ maxWidth: 540, display: "grid", gap: 16 }}>
        <div>
          <Label htmlFor="name">Site name</Label>
          <Input id="name" name="name" placeholder="Acme Wellness" required />
        </div>
        <div>
          <Label htmlFor="slug">Slug (optional)</Label>
          <Input id="slug" name="slug" placeholder="acme" />
          <p style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 6 }}>
            Used internally and as the dev preview path. Auto-derived from the name
            if blank.
          </p>
        </div>
        <div>
          <Label htmlFor="primaryHost">Primary domain (optional)</Label>
          <Input id="primaryHost" name="primaryHost" placeholder="acmewellness.com" />
          <p style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 6 }}>
            Canonical hostname for SEO/sitemap. You can add domains later under the
            site&apos;s Domains tab.
          </p>
        </div>
        <FieldError message={state.error} />
        <SubmitButton />
      </Card>
    </form>
  );
}
