"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { setClientInBodyIdAction } from "@/app/settings/integrations/inbody/actions";

/** The ID this client types on the InBody scanner, if it isn't their phone number. */
export function ClientInBodyIdForm({ clientId, initial }: { clientId: number; initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [pending, start] = useTransition();
  const changed = value.trim() !== initial.trim();

  function save() {
    start(async () => {
      const r = await setClientInBodyIdAction(clientId, value);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.matched > 0 ? `InBody ID saved, and ${r.matched} waiting scans matched` : "InBody ID saved");
      router.refresh();
    });
  }

  return (
    <div className="bs-idform">
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="InBody ID (if not their phone)" aria-label="InBody ID" />
      {changed && (
        <Button size="sm" onClick={save} loading={pending}>
          Save
        </Button>
      )}
    </div>
  );
}
