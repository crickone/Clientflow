"use client";

import { useFormState, useFormStatus } from "react-dom";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FieldError, Input, Label } from "@/components/ui/Input";
import { createPageAction, type NewPageState } from "@/app/cms/[siteSlug]/pages/actions";

const initial: NewPageState = { ok: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create page"}
    </Button>
  );
}

export function NewPageForm({
  siteSlug,
  templates,
}: {
  siteSlug: string;
  templates: { id: string; label: string }[];
}) {
  const action = createPageAction.bind(null, siteSlug);
  const [state, formAction] = useFormState(action, initial);
  return (
    <form action={formAction}>
      <Card style={{ display: "grid", gap: 14, maxWidth: 640 }}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Label htmlFor="title">Page title</Label>
            <Input id="title" name="title" placeholder="About us" required />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Label htmlFor="path">Path</Label>
            <Input id="path" name="path" placeholder="/about" required />
          </div>
        </div>
        <div>
          <Label htmlFor="templateId">Template</Label>
          <select
            id="templateId"
            name="templateId"
            defaultValue={templates[0]?.id}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--hairline)",
              background: "var(--surface)",
              color: "var(--text-primary)",
              fontSize: 14,
            }}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <FieldError message={state.error} />
        <div>
          <SubmitButton />
        </div>
      </Card>
    </form>
  );
}
