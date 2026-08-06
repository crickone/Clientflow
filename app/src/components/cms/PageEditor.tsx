"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, EyeOff, ExternalLink, Save, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Card, CardLabel } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { SeoPreview } from "@/components/cms/SeoPreview";
import {
  savePageAction,
  publishPageAction,
  unpublishPageAction,
  deletePageAction,
} from "@/app/cms/[siteSlug]/pages/actions";

export type EditorBlock = {
  name: string;
  kind: "text" | "richtext" | "image" | "html";
  label: string;
  value: string;
};

export type EditorPage = {
  id: number;
  title: string;
  path: string;
  status: "draft" | "published";
  templateLabel: string;
};

export type EditorSeo = {
  seoTitle: string;
  seoDescription: string;
  canonicalUrl: string;
  robots: string;
  ogImageAssetId: string;
};

export function PageEditor({
  siteSlug,
  page,
  blocks,
  seo,
  previewUrl,
}: {
  siteSlug: string;
  page: EditorPage;
  blocks: EditorBlock[];
  seo: EditorSeo;
  previewUrl: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [seoTitle, setSeoTitle] = useState(seo.seoTitle);
  const [seoDescription, setSeoDescription] = useState(seo.seoDescription);
  const published = page.status === "published";

  async function onSave(formData: FormData) {
    setSaving(true);
    const res = await savePageAction(siteSlug, page.id, formData);
    setSaving(false);
    if (res.ok) {
      toast.success("Saved");
      router.refresh();
    } else {
      toast.error(res.error ?? "Save failed");
    }
  }

  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0,1fr) 320px" }}>
      <form action={onSave}>
        <Card style={{ display: "grid", gap: 16 }}>
          <div>
            <Label htmlFor="title">Page title</Label>
            <Input id="title" name="title" defaultValue={page.title} />
          </div>

          <CardLabel>Content blocks · {page.templateLabel}</CardLabel>
          {blocks.length === 0 && (
            <p style={{ color: "var(--text-tertiary)", fontSize: 13 }}>
              This template has no editable blocks.
            </p>
          )}
          {blocks.map((b) => (
            <div key={b.name}>
              <Label htmlFor={`block__${b.name}`}>
                {b.label}{" "}
                <span style={{ color: "var(--text-tertiary)", fontWeight: 400 }}>
                  ({b.kind})
                </span>
              </Label>
              {b.kind === "image" ? (
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <Input
                    id={`block__${b.name}`}
                    name={`block__${b.name}`}
                    defaultValue={b.value}
                    placeholder="Media ID (from Media library)"
                    style={{ maxWidth: 220 }}
                  />
                  {b.value && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/site-media/${siteSlug}/${b.value}`}
                      alt=""
                      style={{ height: 48, borderRadius: 6, border: "1px solid var(--hairline)" }}
                    />
                  )}
                </div>
              ) : b.kind === "text" ? (
                <Input id={`block__${b.name}`} name={`block__${b.name}`} defaultValue={b.value} />
              ) : (
                <Textarea
                  id={`block__${b.name}`}
                  name={`block__${b.name}`}
                  defaultValue={b.value}
                  rows={b.kind === "html" ? 14 : 5}
                />
              )}
            </div>
          ))}

          <CardLabel>SEO</CardLabel>
          <SeoPreview
            title={seoTitle || page.title}
            description={seoDescription}
            url={previewUrl}
          />
          <div>
            <Label htmlFor="seoTitle">SEO title</Label>
            <Input
              id="seoTitle"
              name="seoTitle"
              value={seoTitle}
              onChange={(e) => setSeoTitle(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="seoDescription">Meta description</Label>
            <Textarea
              id="seoDescription"
              name="seoDescription"
              value={seoDescription}
              onChange={(e) => setSeoDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <Label htmlFor="canonicalUrl">Canonical URL (optional)</Label>
              <Input id="canonicalUrl" name="canonicalUrl" defaultValue={seo.canonicalUrl} />
            </div>
            <div style={{ width: 200 }}>
              <Label htmlFor="robots">Robots</Label>
              <Input id="robots" name="robots" defaultValue={seo.robots || "index,follow"} />
            </div>
          </div>
          <div>
            <Label htmlFor="ogImageAssetId">Social share image (media ID)</Label>
            <Input
              id="ogImageAssetId"
              name="ogImageAssetId"
              defaultValue={seo.ogImageAssetId}
              placeholder="Media ID for OG/Twitter image"
              style={{ maxWidth: 260 }}
            />
          </div>

          <div>
            <Button type="submit" disabled={saving}>
              <Save size={15} />
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </Card>
      </form>

      <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
        <Card style={{ display: "grid", gap: 12 }}>
          <CardLabel>Status</CardLabel>
          <Badge colour={published ? "#3fb950" : "#8b949e"}>{page.status}</Badge>
          {published ? (
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await unpublishPageAction(siteSlug, page.id);
                  toast.success("Unpublished");
                  router.refresh();
                })
              }
            >
              <EyeOff size={15} />
              Unpublish
            </Button>
          ) : (
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await publishPageAction(siteSlug, page.id);
                  toast.success("Published");
                  router.refresh();
                })
              }
            >
              <Eye size={15} />
              Publish
            </Button>
          )}
          <a
            href={`/site/${siteSlug}${page.path === "/" ? "" : page.path}`}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: "var(--text-secondary)",
            }}
          >
            Preview <ExternalLink size={13} />
          </a>
        </Card>

        <Card>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                if (await confirm({ title: "Delete this page permanently?", destructive: true })) {
                  await deletePageAction(siteSlug, page.id);
                }
              })
            }
          >
            <Trash2 size={15} />
            Delete page
          </Button>
        </Card>
      </div>
    </div>
  );
}
