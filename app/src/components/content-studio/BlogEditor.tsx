"use client";

import { useRouter } from "next/navigation";
import {
  type ComponentType,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import {
  Bold,
  Code,
  Copy,
  Download,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  ImagePlus,
  Italic,
  Link as LinkGlyph,
  List,
  ListOrdered,
  Quote,
  RefreshCw,
  Save,
  Strikethrough,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  ImagePicker,
  type PickedImage,
} from "@/components/content-studio/ImagePicker";
import {
  CoverImageField,
  DEFAULT_ASPECT,
  DEFAULT_POSITION,
} from "@/components/content-studio/CoverImageField";
import type { BlogPost } from "@/lib/db/schema";

const STATUS_COPY: Record<
  BlogPost["status"],
  { label: string; tone: string }
> = {
  generating: { label: "Generating…", tone: "#2c6ce0" },
  ready: { label: "Ready", tone: "#15803d" },
  failed: { label: "Failed", tone: "#dc2626" },
};

function ToolButton({
  icon: Icon,
  title,
  onClick,
  disabled,
  active,
}: {
  icon: ComponentType<{ size?: number | string }>;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className="md-toolbar-btn"
    >
      <Icon size={15} />
    </button>
  );
}

export function BlogEditor({ initial }: { initial: BlogPost }) {
  const router = useRouter();
  const [post, setPost] = useState<BlogPost>(initial);
  const [title, setTitle] = useState(initial.title);
  // `content` mirrors the editor as markdown — the source of truth we save,
  // copy, download, and dirty-check against. The WYSIWYG editor parses this
  // markdown on load and re-serializes to markdown on every change.
  const [content, setContent] = useState(initial.content ?? "");
  const [savedTitle, setSavedTitle] = useState(initial.title);
  const [savedContent, setSavedContent] = useState(initial.content ?? "");
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(
    initial.coverImageUrl ?? null,
  );
  const [savedCover, setSavedCover] = useState<string | null>(
    initial.coverImageUrl ?? null,
  );
  const [coverAspect, setCoverAspect] = useState<string | null>(
    initial.coverAspect ?? null,
  );
  const [savedAspect, setSavedAspect] = useState<string | null>(
    initial.coverAspect ?? null,
  );
  const [coverPosition, setCoverPosition] = useState<string | null>(
    initial.coverPosition ?? null,
  );
  const [savedPosition, setSavedPosition] = useState<string | null>(
    initial.coverPosition ?? null,
  );
  const [picker, setPicker] = useState<null | "cover" | "inline">(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const generating = post.status === "generating";

  const editor = useEditor({
    immediatelyRender: false, // Next SSR: render on the client to avoid hydration mismatch
    editable: !generating,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
      Placeholder.configure({
        placeholder: "Write your post — or use the toolbar above.",
      }),
      Markdown.configure({
        html: false,
        linkify: true,
        transformPastedText: true,
      }),
    ],
    content: initial.content ?? "",
    onUpdate: ({ editor }) => {
      setContent(editor.storage.markdown.getMarkdown());
    },
  });

  useEffect(() => {
    editor?.setEditable(!generating);
  }, [editor, generating]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/content-studio/blogs/${initial.id}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        const next = json.post as BlogPost;
        setPost(next);
        // While a post is generating/failed (or we're still empty), the server
        // is the source of truth — sync its content into the editor. Once the
        // user has a ready draft we never silently clobber their edits.
        if (
          next.status === "generating" ||
          next.status === "failed" ||
          savedContent === ""
        ) {
          const md = next.content ?? "";
          setTitle(next.title);
          setContent(md);
          setSavedTitle(next.title);
          setSavedContent(md);
          editor?.commands.setContent(md, false); // false = don't emit an update
        }
      }
    } catch (err) {
      console.error("[blog] refresh failed:", err);
    }
  }, [initial.id, savedContent, editor]);

  useEffect(() => {
    if (post.status === "generating") {
      pollRef.current = setTimeout(refresh, 2000);
      return () => {
        if (pollRef.current) clearTimeout(pollRef.current);
      };
    }
  }, [post.status, refresh]);

  const dirty =
    title !== savedTitle ||
    content !== savedContent ||
    coverImageUrl !== savedCover ||
    coverAspect !== savedAspect ||
    coverPosition !== savedPosition;

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/content-studio/blogs/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content,
          coverImageUrl,
          coverAspect,
          coverPosition,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Couldn't save.");
      }
      setPost(json.post);
      setSavedTitle(json.post.title);
      setSavedContent(json.post.content ?? "");
      setSavedCover(json.post.coverImageUrl ?? null);
      setSavedAspect(json.post.coverAspect ?? null);
      setSavedPosition(json.post.coverPosition ?? null);
      setSavedAt(new Date());
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  async function regenerate() {
    if (
      !confirm(
        "Regenerate this post? Your current draft will be replaced once it's done.",
      )
    ) {
      return;
    }
    setActionError(null);
    try {
      const res = await fetch(`/api/content-studio/blogs/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "regenerate" }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Couldn't restart generation.");
      }
      setPost(json.post);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Couldn't restart generation.",
      );
    }
  }

  async function remove() {
    if (!confirm("Delete this blog post? This can't be undone.")) {
      return;
    }
    try {
      const res = await fetch(`/api/content-studio/blogs/${post.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Couldn't delete.");
      }
      router.push("/content-studio/blogs");
      router.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't delete.");
    }
  }

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(content);
      setSavedAt(new Date());
    } catch {
      setActionError("Couldn't copy to clipboard.");
    }
  }

  function downloadMarkdown() {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || `blog-${post.id}`;
    a.download = `${slug}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function setLink() {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  function handlePicked(image: PickedImage) {
    if (picker === "cover") {
      setCoverImageUrl(image.url);
      if (!coverAspect) setCoverAspect(DEFAULT_ASPECT);
      setCoverPosition(DEFAULT_POSITION); // recentre focal point for the new image
    } else if (picker === "inline") {
      editor
        ?.chain()
        .focus()
        .setImage({ src: image.url, alt: image.alt })
        .run();
    }
    setPicker(null);
  }

  const status = STATUS_COPY[post.status];
  const wordCount = content.split(/\s+/).filter(Boolean).length;

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 920 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: status.tone,
            }}
          >
            {status.label}
          </span>
          {savedAt && (
            <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
              Saved {savedAt.toLocaleTimeString("en-IE", { hour12: false })}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copyToClipboard}
            disabled={!content}
          >
            <Copy size={14} />
            Copy
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={downloadMarkdown}
            disabled={!content}
          >
            <Download size={14} />
            Download .md
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={regenerate}
            disabled={generating}
          >
            <RefreshCw size={14} />
            Regenerate
          </Button>
          <Button type="button" variant="destructive" size="sm" onClick={remove}>
            <Trash2 size={14} />
            Delete
          </Button>
        </div>
      </div>

      {post.status === "failed" && (
        <div
          style={{
            border: "1px solid #dc2626",
            background: "rgba(220, 38, 38, 0.08)",
            color: "#dc2626",
            padding: "10px 14px",
            borderRadius: "var(--radius)",
            fontSize: 13,
          }}
        >
          Generation failed: {post.error ?? "unknown error"}
        </div>
      )}

      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Blog title"
        style={{
          fontSize: 22,
          fontFamily: "var(--font-heading), sans-serif",
          padding: "14px 18px",
          letterSpacing: "-0.005em",
        }}
      />

      {/* Cover / hero image */}
      {coverImageUrl ? (
        <CoverImageField
          url={coverImageUrl}
          aspect={coverAspect ?? DEFAULT_ASPECT}
          position={coverPosition ?? DEFAULT_POSITION}
          onAspect={setCoverAspect}
          onPosition={setCoverPosition}
          onChangeImage={() => setPicker("cover")}
          onRemove={() => {
            setCoverImageUrl(null);
            setCoverAspect(null);
            setCoverPosition(null);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setPicker("cover")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            width: "100%",
            padding: 22,
            border: "1px dashed var(--hairline)",
            borderRadius: "var(--radius)",
            background: "transparent",
            color: "var(--text-secondary)",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          <ImagePlus size={18} />
          Add cover image
        </button>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        <div className="md-toolbar">
          <ToolButton
            icon={Heading1}
            title="Heading 1"
            active={editor?.isActive("heading", { level: 1 })}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
            disabled={generating}
          />
          <ToolButton
            icon={Heading2}
            title="Heading 2"
            active={editor?.isActive("heading", { level: 2 })}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
            disabled={generating}
          />
          <ToolButton
            icon={Heading3}
            title="Heading 3"
            active={editor?.isActive("heading", { level: 3 })}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
            disabled={generating}
          />
          <span className="md-toolbar-sep" />
          <ToolButton
            icon={Bold}
            title="Bold"
            active={editor?.isActive("bold")}
            onClick={() => editor?.chain().focus().toggleBold().run()}
            disabled={generating}
          />
          <ToolButton
            icon={Italic}
            title="Italic"
            active={editor?.isActive("italic")}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            disabled={generating}
          />
          <ToolButton
            icon={Strikethrough}
            title="Strikethrough"
            active={editor?.isActive("strike")}
            onClick={() => editor?.chain().focus().toggleStrike().run()}
            disabled={generating}
          />
          <ToolButton
            icon={Code}
            title="Inline code"
            active={editor?.isActive("code")}
            onClick={() => editor?.chain().focus().toggleCode().run()}
            disabled={generating}
          />
          <span className="md-toolbar-sep" />
          <ToolButton
            icon={List}
            title="Bulleted list"
            active={editor?.isActive("bulletList")}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            disabled={generating}
          />
          <ToolButton
            icon={ListOrdered}
            title="Numbered list"
            active={editor?.isActive("orderedList")}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            disabled={generating}
          />
          <ToolButton
            icon={Quote}
            title="Quote"
            active={editor?.isActive("blockquote")}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
            disabled={generating}
          />
          <ToolButton
            icon={LinkGlyph}
            title="Link"
            active={editor?.isActive("link")}
            onClick={setLink}
            disabled={generating}
          />
          <span className="md-toolbar-sep" />
          <ToolButton
            icon={ImageIcon}
            title="Insert image"
            onClick={() => setPicker("inline")}
            disabled={generating}
          />
        </div>

        <EditorContent editor={editor} className="blog-preview blog-editor" />
      </div>

      {actionError && (
        <div style={{ color: "#dc2626", fontSize: 13 }}>{actionError}</div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
          {content ? `${wordCount} words` : "—"}
        </div>
        <Button onClick={save} disabled={!dirty || saving || generating}>
          <Save size={15} />
          {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </Button>
      </div>

      {picker && (
        <ImagePicker
          title={picker === "cover" ? "Choose a cover image" : "Insert an image"}
          onSelect={handlePicked}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
