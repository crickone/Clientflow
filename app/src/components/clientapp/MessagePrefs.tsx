"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Switch } from "@/components/forms/FormsListView";
import { setConsentAction } from "@/app/app/actions";

/** News and offers on or off, per channel. Turning one off is as easy as turning it on. */
export function MessagePrefs({ items }: { items: { channel: "email" | "sms"; label: string; statement: string; on: boolean }[] }) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, boolean>>(Object.fromEntries(items.map((i) => [i.channel, i.on])));
  const [pending, start] = useTransition();

  function flip(channel: "email" | "sms") {
    const next = !state[channel];
    setState({ ...state, [channel]: next });
    start(async () => {
      const r = await setConsentAction(channel, next);
      if (!r.ok) {
        setState((s) => ({ ...s, [channel]: !next }));
        toast.error(r.error);
        return;
      }
      if (r.note) toast.message(r.note);
      router.refresh();
    });
  }

  return (
    <div className="mp">
      {items.map((i) => (
        <div key={i.channel} className="mp-row">
          <div className="mp-text">
            <b>{i.label}</b>
            <span>{i.statement}</span>
          </div>
          <Switch on={Boolean(state[i.channel])} disabled={pending} onClick={() => flip(i.channel)} />
        </div>
      ))}
    </div>
  );
}
