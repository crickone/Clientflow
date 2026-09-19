"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { History, RotateCcw, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { restorePageVersionAction } from "@/app/cms/[siteSlug]/pages/actions";

export interface HistoryEntry {
  id: number;
  at: string;
  source: string;
  by: string | null;
  note: string | null;
  chars: number;
}

/** Plain words for how a version came to exist. */
const SOURCE_LABEL: Record<string, string> = {
  studio: "Edited here",
  agent: "Changed by Adonis",
  deploy: "Updated by a deploy",
  restore: "Replaced by a restore",
  baseline: "Before history was kept",
};

function when(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return d.toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * A page's saved versions, newest first.
 *
 * The exact timestamp is always shown next to the friendly one: "3 hours
 * ago" is how a person thinks about their own work, but "which version do I
 * want back" is answered by a date and a time, and only one of those
 * survives being read tomorrow.
 */
export function PageHistory({
  siteSlug,
  pageId,
  entries,
}: {
  siteSlug: string;
  pageId: number;
  entries: HistoryEntry[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<number | null>(null);

  async function restore(entry: HistoryEntry) {
    const ok = await confirm({
      title: "Restore this version?",
      body: `The page goes back to how it was on ${new Date(entry.at).toLocaleString("en-IE")}. The version that's live now is saved first, so you can undo this.`,
      confirmLabel: "Restore",
    });
    if (!ok) return;
    setBusyId(entry.id);
    startTransition(async () => {
      const res = await restorePageVersionAction(siteSlug, pageId, entry.id);
      setBusyId(null);
      if (res.ok) {
        toast.success("Page restored.");
        router.refresh();
      } else {
        toast.error(res.error ?? "Could not restore that version.");
      }
    });
  }

  return (
    <section style={{ marginTop: 32 }}>
      <h2
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 15,
          margin: "0 0 4px",
        }}
      >
        <History size={16} strokeWidth={1.8} />
        Version history
      </h2>
      <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--text-secondary)" }}>
        Every published version of this page is kept. Restoring saves the current one first, so
        nothing is lost either way.
      </p>

      {entries.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--hairline)",
            borderRadius: 10,
            padding: "22px 18px",
            fontSize: 13,
            color: "var(--text-tertiary)",
          }}
        >
          No earlier versions yet. The next time this page changes, the version it replaces is saved
          here.
        </div>
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
          {entries.map((e, i) => (
            <li
              key={e.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                padding: "11px 0",
                borderTop: i === 0 ? "1px solid var(--hairline)" : "none",
                borderBottom: "1px solid var(--hairline)",
              }}
            >
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 13.5, color: "var(--text-primary)" }}>
                  {SOURCE_LABEL[e.source] ?? e.source}
                  {e.by && <span style={{ color: "var(--text-secondary)" }}> · {e.by}</span>}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-tertiary)",
                    fontVariantNumeric: "tabular-nums",
                    marginTop: 2,
                  }}
                >
                  {new Date(e.at).toLocaleString("en-IE", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  <span style={{ opacity: 0.7 }}> · {when(e.at)}</span>
                  <span style={{ opacity: 0.7 }}> · {(e.chars / 1024).toFixed(0)} KB</span>
                </div>
                {e.note && (
                  <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 3 }}>{e.note}</div>
                )}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void restore(e)}
                disabled={pending}
                aria-label={`Restore the version from ${new Date(e.at).toLocaleString("en-IE")}`}
              >
                {busyId === e.id ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />}
                Restore
              </Button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
