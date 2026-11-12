"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Bookmark } from "lucide-react";

import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { saveViewAction } from "@/app/(console)/views/actions";

/** Saves the current URL (filters, sort, columns) as a sidebar link. */
export function SaveViewButton() {
  const pathname = usePathname();
  const params = useSearchParams();
  const ask = useConfirm();
  async function onClick() {
    const r = await ask({ title: "Save this view", body: "It appears under Views in the sidebar, for you only.", confirmLabel: "Save", prompt: { label: "Name", placeholder: "Past due gyms", minLength: 2 } });
    if (!r.ok) return;
    const href = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    const res = await saveViewAction(r.value, href);
    if (res.ok) notify.ok(`Saved "${r.value}"`);
    else notify.fail(res.error);
  }
  return (
    <button type="button" className="btn btn--ghost btn--md" onClick={onClick}>
      <Bookmark size={14} strokeWidth={1.75} aria-hidden /> Save view
    </button>
  );
}
