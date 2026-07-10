"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, RotateCcw, X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import {
  fulfilRequestAction,
  declineRequestAction,
  reopenRequestAction,
} from "@/app/cms/requests/actions";

export function RequestActions({
  id,
  status,
}: {
  id: number;
  status: "new" | "approved" | "declined" | "fulfilled";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (status === "fulfilled") {
    return <span style={{ color: "var(--text-tertiary)", fontSize: 13 }}>Site created</span>;
  }

  return (
    <div style={{ display: "flex", gap: 8 }}>
      {status !== "declined" ? (
        <>
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await fulfilRequestAction(id);
                toast.success("Site created");
              })
            }
          >
            <Check size={14} /> Create site
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await declineRequestAction(id);
                router.refresh();
              })
            }
          >
            <X size={14} /> Decline
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await reopenRequestAction(id);
              router.refresh();
            })
          }
        >
          <RotateCcw size={14} /> Reopen
        </Button>
      )}
    </div>
  );
}
