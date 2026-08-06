"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Send, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { bulkInviteMembersAction } from "@/app/clients/appAccessActions";

/**
 * Clients-list actions: import from a CSV, and bulk-invite everyone eligible to
 * the member app. "Invite to app" targets all clients with an email and no
 * existing login (scoped to the current tenant by the server action).
 */
export function ClientsToolbar({ addLabel }: { addLabel: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();

  const inviteAll = () =>
    start(async () => {
      const ok = await confirm({
        title: "Invite members to the app?",
        body: "Everyone with an email address and no app login yet will be emailed a link to set their password.",
        confirmLabel: "Send invites",
      });
      if (!ok) return;
      const res = await bulkInviteMembersAction(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `${res.sent} invite${res.sent === 1 ? "" : "s"} sent` +
          (res.skipped ? ` · ${res.skipped} skipped` : ""),
      );
      router.refresh();
    });

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <Button variant="outline" size="sm" onClick={inviteAll} loading={pending}>
        <Send size={14} /> Invite to app
      </Button>
      <Link href="/clients/import">
        <Button variant="outline" size="sm">
          <Upload size={14} /> Import
        </Button>
      </Link>
      <Link href="/clients/new">
        <Button size="sm">{addLabel}</Button>
      </Link>
    </div>
  );
}
