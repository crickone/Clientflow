"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { allowContactAgainAction } from "@/app/leads/actions";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";

export function AllowContactButton({ leadId }: { leadId: number }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const confirm = useConfirm();
  return (
    <Button
      variant="outline"
      size="sm"
      loading={pending}
      onClick={async () => {
        const yes = await confirm({
          title: "Allow contact again?",
          body: "Follow-ups can start for this lead again. Do not call and the do-not-email list stay as they are; change those separately.",
          confirmLabel: "Allow contact",
        });
        if (!yes) return;
        start(async () => {
          const res = await allowContactAgainAction(leadId);
          if (res.ok) {
            toast.success("Contact allowed again.");
            router.refresh();
          } else toast.error("Could not change it. Try again.");
        });
      }}
    >
      Allow contact again
    </Button>
  );
}
