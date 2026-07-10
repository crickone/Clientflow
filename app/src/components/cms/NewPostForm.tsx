"use client";

import { useFormState, useFormStatus } from "react-dom";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FieldError, Input, Label, Textarea } from "@/components/ui/Input";
import { createPostAction, type NewPostState } from "@/app/cms/[siteSlug]/blog/actions";

const initial: NewPostState = { ok: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Generating…" : "Generate draft"}
    </Button>
  );
}

export function NewPostForm({ siteSlug }: { siteSlug: string }) {
  const action = createPostAction.bind(null, siteSlug);
  const [state, formAction] = useFormState(action, initial);
  return (
    <form action={formAction}>
      <Card style={{ maxWidth: 640, display: "grid", gap: 16 }}>
        <div>
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" placeholder="Your blog post title" required />
        </div>
        <div>
          <Label htmlFor="prompt">Direction for the AI (optional)</Label>
          <Textarea
            id="prompt"
            name="prompt"
            rows={4}
            placeholder="Angle, key points to cover, audience, calls to action…"
          />
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <Label htmlFor="tone">Tone (optional)</Label>
            <Input id="tone" name="tone" placeholder="warm, expert, plain-English" />
          </div>
          <div style={{ width: 160 }}>
            <Label htmlFor="targetWords">Target words</Label>
            <Input id="targetWords" name="targetWords" type="number" defaultValue={700} min={200} max={2000} />
          </div>
        </div>
        <FieldError message={state.error} />
        <div>
          <SubmitButton />
        </div>
      </Card>
    </form>
  );
}
