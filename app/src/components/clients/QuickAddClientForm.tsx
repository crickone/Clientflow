"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import type { Client } from "@/lib/db/schema";
import { Button } from "@/components/ui/Button";
import { DialogClose } from "@/components/ui/Dialog";
import { Input, Label } from "@/components/ui/Input";
import { useVocab } from "@/components/providers/VocabProvider";
import { quickAddClientAction } from "@/app/clients/actions";

function splitName(q: string): { firstName: string; lastName: string } {
  const parts = q.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === "") return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function QuickAddClientForm({
  initialSearch,
  onCreated,
}: {
  initialSearch?: string;
  onCreated: (c: Client) => void;
}) {
  const [pending, start] = useTransition();
  const vocab = useVocab();
  const seeded = splitName(initialSearch ?? "");

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      try {
        const created = await quickAddClientAction(fd);
        onCreated(created as Client);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed.");
      }
    });
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <Label htmlFor="firstName">First name</Label>
          <Input
            id="firstName"
            name="firstName"
            defaultValue={seeded.firstName}
            required
            autoFocus
          />
        </div>
        <div>
          <Label htmlFor="lastName">Last name</Label>
          <Input
            id="lastName"
            name="lastName"
            defaultValue={seeded.lastName}
            required
          />
        </div>
      </div>
      <div>
        <Label htmlFor="phone">Phone</Label>
        <Input id="phone" name="phone" type="tel" required />
      </div>
      <div>
        <Label htmlFor="email">Email (optional)</Label>
        <Input id="email" name="email" type="email" />
      </div>
      <p
        style={{
          fontSize: 12,
          color: "var(--text-tertiary)",
          margin: 0,
        }}
      >
        You can add address, DOB, medical notes, and GDPR later from the{" "}
        {vocab.member.toLowerCase()}&apos;s profile.
      </p>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add & select"}
        </Button>
      </div>
    </form>
  );
}
