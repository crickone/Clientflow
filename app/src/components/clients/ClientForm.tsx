"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Stethoscope } from "lucide-react";
import type { Client } from "@/lib/db/schema";
import { Button } from "@/components/ui/Button";
import { FieldError, Input, Label, Textarea } from "@/components/ui/Input";
import { Card, CardLabel } from "@/components/ui/Card";
import { useVocab } from "@/components/providers/VocabProvider";
import {
  createClientAction,
  updateClientAction,
  type ClientFormState,
} from "@/app/clients/actions";

interface Props {
  client?: Client;
}

export function ClientForm({ client }: Props) {
  const action = client
    ? updateClientAction.bind(null, client.id)
    : createClientAction;
  const [state, formAction] = useFormState<ClientFormState | null, FormData>(
    action,
    null,
  );

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Card>
        <CardLabel>Contact</CardLabel>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
          }}
        >
          <Field label="First name" name="firstName" required defaultValue={client?.firstName} error={state?.errors?.firstName} />
          <Field label="Last name" name="lastName" required defaultValue={client?.lastName} error={state?.errors?.lastName} />
          <Field label="Email" name="email" type="email" defaultValue={client?.email ?? ""} error={state?.errors?.email} />
          <Field label="Phone" name="phone" required defaultValue={client?.phone} error={state?.errors?.phone} />
          <Field label="Date of birth" name="dateOfBirth" type="date" defaultValue={client?.dateOfBirth ?? ""} error={state?.errors?.dateOfBirth} />
        </div>
        <div style={{ marginTop: 16 }}>
          <Label htmlFor="address">Address</Label>
          <Textarea id="address" name="address" rows={3} defaultValue={client?.address ?? ""} />
        </div>
      </Card>

      <Card>
        <CardLabel
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Stethoscope size={13} />
          Medical & emergency
        </CardLabel>
        <div style={{ marginBottom: 16 }}>
          <Label htmlFor="medicalNotes">Medical notes</Label>
          <Textarea
            id="medicalNotes"
            name="medicalNotes"
            rows={4}
            defaultValue={client?.medicalNotes ?? ""}
            placeholder="Allergies, conditions, contraindications…"
          />
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
          }}
        >
          <Field
            label="Emergency contact name"
            name="emergencyContactName"
            defaultValue={client?.emergencyContactName ?? ""}
          />
          <Field
            label="Emergency contact phone"
            name="emergencyContactPhone"
            defaultValue={client?.emergencyContactPhone ?? ""}
          />
        </div>
      </Card>

      <Card>
        <CardLabel>Consent</CardLabel>
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            name="gdprConsent"
            defaultChecked={client?.gdprConsent ?? false}
            style={{ marginTop: 2 }}
          />
          <div>
            <div style={{ color: "var(--text-primary)", fontWeight: 500, fontSize: 14 }}>
              GDPR consent on file
            </div>
            <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 2 }}>
              {client?.gdprConsentDate
                ? `Recorded on ${new Date(client.gdprConsentDate).toLocaleDateString("en-IE")}`
                : "Date will be recorded automatically when ticked"}
            </div>
          </div>
        </label>
      </Card>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <SubmitButton edit={!!client} />
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  required,
  defaultValue,
  error,
  type = "text",
}: {
  label: string;
  name: string;
  required?: boolean;
  defaultValue?: string;
  error?: string;
  type?: string;
}) {
  return (
    <div>
      <Label htmlFor={name}>
        {label}
        {required && <span style={{ color: "#dc2626", marginLeft: 4 }}>*</span>}
      </Label>
      <Input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
      />
      <FieldError message={error} />
    </div>
  );
}

function SubmitButton({ edit }: { edit: boolean }) {
  const { pending } = useFormStatus();
  const vocab = useVocab();
  return (
    <Button type="submit" disabled={pending}>
      {pending
        ? "Saving…"
        : edit
          ? "Save changes"
          : `Add ${vocab.member.toLowerCase()}`}
    </Button>
  );
}
