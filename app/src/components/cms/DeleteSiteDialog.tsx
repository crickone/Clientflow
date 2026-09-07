"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  deleteSiteAction,
  getSiteDeletionSummaryAction,
} from "@/app/cms/actions";
import type { SiteDeletionSummary } from "@/lib/cms/sites";

/**
 * Plain-language sentence for what a delete would remove, e.g. "9 pages, 4
 * blog posts, 12 media records and 1 domain mapping". Zero-count categories
 * are left out so an empty site doesn't read as "0 pages, 0 blog posts…".
 */
function summarySentence(summary: SiteDeletionSummary): string {
  const parts: string[] = [];
  const add = (n: number, singular: string, plural: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? singular : plural}`);
  };
  add(summary.pages, "page", "pages");
  add(summary.blogPosts, "blog post", "blog posts");
  add(summary.mediaAssets, "media record", "media records");
  add(summary.contentBlocks, "content block", "content blocks");
  add(summary.domains.length, "domain mapping", "domain mappings");

  if (parts.length === 0) return "nothing else — this site has no content yet";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function DeleteSiteDialog({ site }: { site: { slug: string; name: string } }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [loadingSummary, setLoadingSummary] = React.useState(false);
  const [summary, setSummary] = React.useState<SiteDeletionSummary | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [confirmSlug, setConfirmSlug] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);

  const verifiedDomains = summary ? summary.domains.filter((d) => d.verified).length : 0;
  const canConfirm = !!summary && !deleting && confirmSlug === site.slug && verifiedDomains === 0;

  async function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Reset on close so a re-open never shows stale state.
      setSummary(null);
      setLoadError(null);
      setConfirmSlug("");
      return;
    }
    setLoadingSummary(true);
    setLoadError(null);
    const res = await getSiteDeletionSummaryAction(site.slug);
    setLoadingSummary(false);
    if (res.ok) setSummary(res.summary);
    else setLoadError(res.error);
  }

  async function handleDelete() {
    setDeleting(true);
    const res = await deleteSiteAction(site.slug, confirmSlug);
    setDeleting(false);
    if (res.ok) {
      toast.success(`"${site.name}" deleted.`);
      setOpen(false);
      setSummary(null);
      setConfirmSlug("");
      router.refresh();
    } else {
      toast.error(res.error ?? "Could not delete this site.");
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Trigger asChild>
        <Button
          variant="ghost"
          size="sm"
          style={{ color: "var(--text-tertiary)" }}
          aria-label={`Delete ${site.name}`}
        >
          <Trash2 size={14} />
          Delete
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(10,10,10,0.32)",
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
            zIndex: 80,
          }}
        />
        <DialogPrimitive.Content
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "min(94vw, 480px)",
            background: "var(--bg)",
            border: "1px solid var(--hairline)",
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow-2)",
            zIndex: 90,
            padding: 24,
          }}
        >
          <DialogPrimitive.Title
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              fontFamily: "var(--font-heading), sans-serif",
              fontSize: 19,
              fontWeight: 400,
              textTransform: "uppercase",
              color: "var(--text-primary)",
              marginBottom: 8,
              lineHeight: 1.15,
            }}
          >
            <AlertTriangle size={18} color="#dc2626" />
            Delete &ldquo;{site.name}&rdquo;
          </DialogPrimitive.Title>
          <DialogPrimitive.Description
            style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 18, lineHeight: 1.5 }}
          >
            This cannot be undone. The site and its content stop existing the
            moment you confirm — there is no trash or recovery step.
          </DialogPrimitive.Description>

          {loadingSummary && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "var(--text-tertiary)",
                fontSize: 14,
                padding: "10px 0",
              }}
            >
              <Loader2 className="spin" size={14} />
              Checking what would be removed…
            </div>
          )}

          {loadError && (
            <div style={{ color: "#dc2626", fontSize: 14, marginBottom: 14 }}>{loadError}</div>
          )}

          {summary && (
            <div
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--hairline)",
                borderRadius: "var(--radius)",
                padding: "12px 14px",
                fontSize: 13.5,
                color: "var(--text-secondary)",
                lineHeight: 1.5,
                marginBottom: 18,
              }}
            >
              This will permanently delete {summarySentence(summary)}.
              {verifiedDomains > 0 && (
                <div style={{ color: "#dc2626", marginTop: 8, fontWeight: 500 }}>
                  This site still has {verifiedDomains === 1 ? "a verified domain" : "verified domains"}{" "}
                  mapped to it. Remove {verifiedDomains === 1 ? "it" : "them"} under Domains before
                  deleting the site — deleting it now would take a live client website down.
                </div>
              )}
            </div>
          )}

          <label
            htmlFor="confirm-slug"
            style={{ display: "block", fontSize: 13, color: "var(--text-tertiary)", marginBottom: 6 }}
          >
            Type <strong style={{ color: "var(--text-primary)" }}>{site.slug}</strong> to confirm
          </label>
          <Input
            id="confirm-slug"
            value={confirmSlug}
            onChange={(e) => setConfirmSlug(e.target.value)}
            placeholder={site.slug}
            autoComplete="off"
            spellCheck={false}
            disabled={!summary || deleting}
          />

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 22 }}>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="sm" disabled={deleting}>
                Cancel
              </Button>
            </DialogPrimitive.Close>
            <Button
              variant="destructive"
              size="sm"
              disabled={!canConfirm}
              loading={deleting}
              onClick={handleDelete}
            >
              Delete site permanently
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
