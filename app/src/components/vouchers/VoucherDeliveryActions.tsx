"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { changeRecipientEmailAction, resendVoucherAction } from "@/app/vouchers/[code]/actions";

/** Resend the voucher email; for a gift to someone else, fix their address first if needed. */
export function VoucherDeliveryActions({ voucherId, recipientEmail }: { voucherId: number; recipientEmail: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState(recipientEmail ?? "");
  const [sending, startSend] = useTransition();
  const [saving, startSave] = useTransition();

  const resend = () =>
    startSend(async () => {
      const r = await resendVoucherAction(voucherId);
      if (r.ok) toast.success("Sent.");
      else toast.error(r.error);
      router.refresh();
    });
  const saveEmail = () =>
    startSave(async () => {
      const r = await changeRecipientEmailAction(voucherId, email);
      if (r.ok) toast.success("Email address saved. Press Resend to send it there.");
      else toast.error(r.error);
      router.refresh();
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {recipientEmail !== null && (
        <div>
          <Label htmlFor="vd-email">Recipient email</Label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 220px" }}>
              <Input id="vd-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <Button type="button" variant="secondary" onClick={saveEmail} loading={saving} disabled={email.trim().toLowerCase() === recipientEmail}>
              Save email
            </Button>
          </div>
        </div>
      )}
      <div>
        <Button type="button" onClick={resend} loading={sending}>
          Resend
        </Button>
      </div>
    </div>
  );
}
