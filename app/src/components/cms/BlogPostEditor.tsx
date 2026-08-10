"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Clock, ExternalLink, Eye, EyeOff, Loader2, Save, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Card, CardLabel } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { MarkdownEditor } from "@/components/ui/MarkdownEditor";
import { CoverImageField } from "@/components/content-studio/CoverImageField";
import { ImagePicker } from "@/components/content-studio/ImagePicker";
import { ImagePlus } from "lucide-react";
import { SeoPreview } from "@/components/cms/SeoPreview";
import {
  savePostAction,
  publishPostAction,
  unpublishPostAction,
  schedulePostAction,
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
  coverImageUrl: string | null;
  coverAspect: string | null;
  coverPosition: string | null;
  status: "generating" | "ready" | "failed";
  publishState: "draft" | "scheduled" | "published";
  scheduledFor: string | null;
  error: string | null;
};

const COVER_ASPECT_DEFAULT = "16 / 9";
const COVER_POSITION_DEFAULT = "50% 50%";

/** Local wall-clock value for <input type="datetime-local"> (no timezone). */
function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const SCHEDULE_BADGE_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Deterministic UTC formatting (no Intl/locale) for the "scheduled for…" badge
 * text — this component is a Client Component, so anything locale- or
 * timezone-dependent here would render differently on the server vs. the
 * browser and trip a hydration mismatch. The <input> itself uses local time
 * (via toDatetimeLocalValue, filled in post-mount below) since that's what
 * the native picker expects.
 */
function formatScheduledFor(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${SCHEDULE_BADGE_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

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
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [slug, setSlug] = useState(post.slug);
  const [seoTitle, setSeoTitle] = useState(post.seoTitle);
  const [seoDescription, setSeoDescription] = useState(post.seoDescription);
  // WYSIWYG edits visually but stores markdown; a hidden input carries it into
  // the form so savePostAction still reads formData.get("content").
  const [content, setContent] = useState(post.content);
  const [coverUrl, setCoverUrl] = useState<string | null>(post.coverImageUrl);
  const [coverAspect, setCoverAspect] = useState(post.coverAspect ?? COVER_ASPECT_DEFAULT);
  const [coverPosition, setCoverPosition] = useState(post.coverPosition ?? COVER_POSITION_DEFAULT);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  // Datetime-local value for the schedule picker. Always starts empty (server
  // and first client render must match) — filled in from post.scheduledFor by
  // the effect below, which only runs in the browser, so a scheduled post's
  // existing time appears in the picker without any SSR/client mismatch risk
  // from converting a UTC timestamp to the viewer's local wall-clock time.
  const [scheduleInput, setScheduleInput] = useState("");

  // While the AI is generating, refresh the server component to pick up content.
  useEffect(() => {
    if (post.status !== "generating") return;
    const id = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(id);
  }, [post.status, router]);

  useEffect(() => {
    // Always sync both directions: a fresh schedule fills the picker, and
    // Publish-now/Cancel-schedule clearing scheduledFor to null must clear the
    // picker too — otherwise it'd keep showing a stale time after cancelling.
    setScheduleInput(post.scheduledFor ? toDatetimeLocalValue(new Date(post.scheduledFor)) : "");
  }, [post.scheduledFor]);

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

  function onSchedule() {
    if (!scheduleInput) {
      toast.error("Pick a date and time first.");
      return;
    }
    // Convert the local wall-clock picker value to a full ISO string (with
    // timezone) HERE, in the browser, using the browser's own timezone — so
    // schedulePostAction's validation on the server is never ambiguous about
    // which timezone the bare "YYYY-MM-DDTHH:mm" value meant.
    const iso = new Date(scheduleInput).toISOString();
    startTransition(async () => {
      const res = await schedulePostAction(siteSlug, post.id, iso);
      if (res.ok) {
        toast.success("Scheduled");
        router.refresh();
      } else {
        toast.error(res.error ?? "Could not schedule this post.");
      }
    });
  }

  const published = post.publishState === "published";
  const scheduled = post.publishState === "scheduled";

  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0,1fr) 320px" }}>
      <form action={onSave}>
        <Card style={{ display: "grid", gap: 16 }}>
          <div>
            <Label>Cover image</Label>
            {coverUrl ? (
              <CoverImageField
                url={coverUrl}
                aspect={coverAspect}
                position={coverPosition}
                onAspect={setCoverAspect}
                onPosition={setCoverPosition}
                onChangeImage={() => setCoverPickerOpen(true)}
                onRemove={() => {
                  setCoverUrl(null);
                  setCoverAspect(COVER_ASPECT_DEFAULT);
                  setCoverPosition(COVER_POSITION_DEFAULT);
                }}
              />
            ) : (
              <Button type="button" variant="outline" onClick={() => setCoverPickerOpen(true)}>
                <ImagePlus size={15} /> Add cover image
              </Button>
            )}
            <input type="hidden" name="coverImageUrl" value={coverUrl ?? ""} />
            <input type="hidden" name="coverAspect" value={coverAspect} />
            <input type="hidden" name="coverPosition" value={coverPosition} />
          </div>
          <div>
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" defaultValue={post.title} />
          </div>
          <div>
            <Label htmlFor="content">Content</Label>
            <MarkdownEditor value={post.content} onChange={setContent} placeholder="Write your post — or use the toolbar above." />
            <input type="hidden" name="content" value={content} />
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
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Badge colour={published ? "#3fb950" : scheduled ? "#d29922" : "#8b949e"}>{post.publishState}</Badge>
            {scheduled && post.scheduledFor && (
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {formatScheduledFor(post.scheduledFor)}
              </span>
            )}
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
              <>
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
                  {scheduled ? "Publish now" : "Publish"}
                </Button>

                <div style={{ display: "grid", gap: 6, paddingTop: 8, borderTop: "1px solid var(--grid)" }}>
                  <Label htmlFor="scheduledFor">{scheduled ? "Reschedule for" : "Schedule for later"}</Label>
                  <Input
                    id="scheduledFor"
                    type="datetime-local"
                    value={scheduleInput}
                    onChange={(e) => setScheduleInput(e.target.value)}
                  />
                  <Button variant="outline" disabled={pending || !scheduleInput} onClick={onSchedule}>
                    <Clock size={15} />
                    {scheduled ? "Reschedule" : "Schedule"}
                  </Button>
                </div>

                {scheduled && (
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await unpublishPostAction(siteSlug, post.id);
                        toast.success("Schedule cancelled");
                        router.refresh();
                      })
                    }
                  >
                    <EyeOff size={15} />
                    Cancel schedule
                  </Button>
                )}
              </>
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
                if (await confirm({ title: "Delete this post permanently?", destructive: true })) {
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

      {/* Rendered outside the <form> so the picker's buttons never submit it. */}
      {coverPickerOpen && (
        <ImagePicker
          title="Choose a cover image"
          onSelect={(image) => {
            setCoverUrl(image.url);
            setCoverAspect(COVER_ASPECT_DEFAULT);
            setCoverPosition(COVER_POSITION_DEFAULT);
            setCoverPickerOpen(false);
          }}
          onClose={() => setCoverPickerOpen(false)}
        />
      )}
    </div>
  );
}
