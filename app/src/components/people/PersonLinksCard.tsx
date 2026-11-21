"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { decidePersonLink } from "@/app/clients/personLinkActions";
import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { LinkLine } from "@/lib/adonisMap/decisions";

/** Records that may be, or are, the same person as this one. Join, keep separate, or unlink. */
export function PersonLinksCard({ linked, reviews }: { linked: LinkLine[]; reviews: LinkLine[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  if (linked.length === 0 && reviews.length === 0) return null;

  async function decide(line: LinkLine, decision: "join" | "separate", unlink = false) {
    // Ask before the transition starts: a confirm awaited inside it never renders.
    if (unlink && !(await confirm({ title: `Unlink ${line.name}?`, body: "They show as two people again, and Adonis stops treating them as one.", confirmLabel: "Unlink", destructive: true }))) return;
    start(async () => {
      const r = await decidePersonLink(line.leadId, line.clientId, decision);
      if (!r.ok) toast.error(r.error);
      else toast.success(unlink ? "Unlinked." : decision === "join" ? "Joined into one person." : "Kept separate.");
      router.refresh();
    });
  }

  return (
    <Card className="cp-card">
      {reviews.length > 0 && (
        <>
          <CardLabel>Possible same person</CardLabel>
          <div style={{ display: "grid", gap: 14, margin: "4px 0 8px" }}>
            {reviews.map((line) => (
              <div key={`r-${line.leadId}-${line.clientId}`} style={{ display: "grid", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <Link href={line.href} style={{ fontWeight: 600 }}>{line.name}</Link>
                  {line.detail && <div className="cp-notes">{line.detail}</div>}
                  <div className="cp-notes">{line.reason}</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button size="sm" variant="outline" onClick={() => void decide(line, "join")} disabled={pending}>Join</Button>
                  <Button size="sm" variant="ghost" onClick={() => void decide(line, "separate")} disabled={pending}>Keep separate</Button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {linked.length > 0 && (
        <>
          <CardLabel>Linked records</CardLabel>
          <div style={{ display: "grid", gap: 10, marginTop: 4 }}>
            {linked.map((line) => (
              <div key={`l-${line.leadId}-${line.clientId}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <Link href={line.href} style={{ fontWeight: 600 }}>{line.name}</Link>
                  <div className="cp-notes">{line.reason}</div>
                </div>
                {line.canUnlink && (
                  <Button size="sm" variant="ghost" onClick={() => void decide(line, "separate", true)} disabled={pending}>Unlink</Button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
