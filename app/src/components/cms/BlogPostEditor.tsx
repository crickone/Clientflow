"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, Eye, EyeOff, Loader2, Save, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { SeoPreview } from "@/components/cms/SeoPreview";
import {
  savePostAction,
  publishPostAction,
  unpublishPostAction,
  deletePostAction,
} from "@/app/cms/[siteSlug]/blog/actions";

type EditorPost = {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  seoTitle: string;
  seoDescription: string;
  status: "generating" | "ready" | "failed";
  publishState: "draft" | "scheduled" | "published";
  error: string | null;
};

export function BlogPostEditor({
  siteSlug,
  post,
  siteBaseUrl,
}: {
  siteSlug: string;
  post: EditorPost;
  siteBaseUrl: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [slug, setSlug] = useState(post.slug);
  const [seoTitle, setSeoTitle] = useState(post.seoTitle);
  const [seoDescription, setSeoDescription] = useState(post.seoDescription);

  // While the AI is generating, refresh the server component to pick up content.
  useEffect(() => {
    if (post.status !== "generating") return;
    const id = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(id);
  }, [post.status, router]);

  if (post.status === "generating") {
    return (
      <Card style={{ maxWidth: 720, display: "flex", alignItems: "center", gap: 12 }}>
        <Loader2 size={18} className="spin" />
        <span style={{ color: "var(--text-secondary)" }}>
          Claude is writing your draft… this page updates automatically.
        </span>
      </Card>
    );
  }

  async function onSave(formData: FormData) {
    setSaving(true);
    const res = await savePostAction(siteSlug, post.id, formData);
    setSaving(false);
    if (res.ok) {
      toast.success("Saved");
      router.refresh();
    } else {
      toast.error(res.error ?? "Save failed");
    }
  }

  const published = post.publishState === "published";

  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0,1fr) 320px" }}>
      <form action={onSave}>
        <Card style={{ display: "grid", gap: 16 }}>
          <div>
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" defaultValue={post.title} />
          </div>
          <div>
            <Label htmlFor="content">Content (markdown)</Label>
            <Textarea id="content" name="content" defaultValue={post.content} rows={22} />
          </div>
          {/* SEO fields submit with the same form */}
          <input type="hidden" name="_seo" value="1" />
          <div>
            <CardLabel>SEO</CardLabel>
            <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
              <SeoPreview
                title={seoTitle || post.title}
                description={seoDescription || post.excerpt}
                url={`${siteBaseUrl}/blog/${slug || "post"}`}
              />
              <div>
                <Label htmlFor="slug">Slug</Label>
                <Input id="slug" name="slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="excerpt">Excerpt</Label>
                <Textarea id="excerpt" name="excerpt" defaultValue={post.excerpt} rows={2} />
              </div>
              <div>
                <Label htmlFor="seoTitle">SEO title</Label>
                <Input id="seoTitle" name="seoTitle" value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} />
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
            </div>
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
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Badge colour={published ? "#3fb950" : "#8b949e"}>{post.publishState}</Badge>
            {post.status === "failed" && <Badge colour="#f85149">generation failed</Badge>}
          </div>
          {post.error && (
            <p style={{ color: "#f85149", fontSize: 12 }}>{post.error}</p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {published ? (
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await unpublishPostAction(siteSlug, post.id);
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
                    await publishPostAction(siteSlug, post.id);
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
              href={`/site/${siteSlug}/blog/${post.slug}`}
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
          </div>
        </Card>

        <Card>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                if (confirm("Delete this post permanently?")) {
                  await deletePostAction(siteSlug, post.id);
                }
              })
            }
          >
            <Trash2 size={15} />
            Delete post
          </Button>
        </Card>
      </div>
    </div>
  );
}
