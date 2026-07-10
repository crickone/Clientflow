"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { useVocab } from "@/components/providers/VocabProvider";
import { deleteClientAction } from "@/app/clients/actions";

interface Props {
  clientId: number;
  clientName: string;
  appointmentCount: number;
  packageCount: number;
}

export function DeleteClientButton({
  clientId,
  clientName,
  appointmentCount,
  packageCount,
}: Props) {
  const [pending, start] = useTransition();
  const vocab = useVocab();

  function onClick() {
    const extras: string[] = [];
    if (appointmentCount > 0)
      extras.push(
        `${appointmentCount} ${(appointmentCount === 1 ? vocab.booking : vocab.bookings).toLowerCase()}`,
      );
    if (packageCount > 0)
      extras.push(
        `${packageCount} ${(packageCount === 1 ? vocab.plan : vocab.plans).toLowerCase()}`,
      );
    const tail = extras.length
      ? `\n\nThis will also delete ${extras.join(" and ")}.`
      : "";
    if (
      !confirm(
        `Delete ${clientName}?${tail}\n\nThis cannot be undone.`,
      )
    )
      return;
    start(async () => {
      try {
        await deleteClientAction(clientId);
      } catch (err) {
        // Server redirects on success — a thrown NEXT_REDIRECT is expected.
        if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) return;
        toast.error(err instanceof Error ? err.message : "Delete failed.");
      }
    });
  }

  return (
    <Button
      variant="outline"
      onClick={onClick}
      disabled={pending}
      style={{ color: "#dc2626", borderColor: "#dc2626" }}
    >
      <Trash2 size={14} />
      {pending ? "Deleting…" : "Delete"}
    </Button>
  );
}
