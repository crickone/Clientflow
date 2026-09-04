"use client";

import { useFormState } from "react-dom";

import { Card, CardLabel } from "@/components/ui/Card";
import { FieldError, Input, Label, Textarea } from "@/components/ui/Input";
import { LeadSubmitButton } from "@/components/leads/LeadSubmitButton";
import { createManualLeadAction, type LeadFormState } from "@/app/leads/actions";

/** Add-lead form (`/leads/new`). Split out of the page as a client component
 * because `useFormState` needs one — the page itself stays a server
 * component so its `db.select()` (therapy list) + vocab lookup don't need to
 * round-trip through an API route. See NewPageForm.tsx for the same
 * server-fetch-props-in/client-form-out split. */
export function NewLeadForm({
  serviceLabel,
  therapyOptions,
}: {
  serviceLabel: string;
  therapyOptions: { id: number; name: string }[];
}) {
  const [state, formAction] = useFormState<LeadFormState | null, FormData>(
    createManualLeadAction,
    null,
  );

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Card>
        <CardLabel>Person</CardLabel>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
          }}
        >
          <div>
            <Label htmlFor="firstName" srOnly>First name *</Label>
            <Input
              id="firstName"
              name="firstName"
              placeholder="First name *"
              required
              error={state?.errors?.firstName}
            />
            <FieldError message={state?.errors?.firstName} />
          </div>
          <div>
            <Label htmlFor="lastName" srOnly>Last name</Label>
            <Input id="lastName" name="lastName" placeholder="Last name" />
          </div>
          <div>
            <Label htmlFor="email" srOnly>Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="Email"
              error={state?.errors?.email}
            />
            <FieldError message={state?.errors?.email} />
          </div>
          <div>
            <Label htmlFor="phone" srOnly>Phone</Label>
            <Input id="phone" name="phone" placeholder="Phone" />
          </div>
        </div>
      </Card>

      <Card>
        <CardLabel>Interest</CardLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <Label htmlFor="therapyInterest">{serviceLabel}</Label>
            <select
              id="therapyInterest"
              name="therapyInterest"
              defaultValue=""
              style={{
                width: "100%",
                background: "var(--bg)",
                border: "1px solid var(--hairline)",
                borderRadius: "var(--radius)",
                padding: "10px 14px",
                color: "var(--text-primary)",
                fontSize: 14,
                fontFamily: "inherit",
              }}
            >
              <option value="">Not sure / general</option>
              {therapyOptions.map((t) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="campaign" srOnly>Source / campaign</Label>
            <Input
              id="campaign"
              name="campaign"
              placeholder="Source / campaign"
            />
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <Label htmlFor="notes" srOnly>Notes from them</Label>
          <Textarea
            id="notes"
            name="notes"
            rows={3}
            placeholder="Notes from them"
          />
        </div>
      </Card>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <LeadSubmitButton />
      </div>
    </form>
  );
}
