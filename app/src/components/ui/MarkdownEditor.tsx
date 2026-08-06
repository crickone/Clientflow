"use client";

import { type ComponentType, useEffect, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageGlyph,
  Italic,
  Link as LinkGlyph,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from "lucide-react";

import { ImagePicker } from "@/components/content-studio/ImagePicker";

/**
 * Reusable WYSIWYG markdown editor (TipTap). Edits visually but the source of
 * truth is markdown — `value` is markdown in, `onChange` gives markdown back.
 * Reuses the `.blog-editor` / `.md-toolbar` styles in globals.css.
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder = "Write here…",
  editable = true,
}: {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  editable?: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const editor = useEditor({
    immediatelyRender: false, // Next SSR: render on the client, avoid hydration mismatch
    editable,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
      Placeholder.configure({ placeholder }),
      Markdown.configure({ html: false, linkify: true, transformPastedText: true }),
    ],
    content: value ?? "",
    onUpdate: ({ editor }) => onChange(editor.storage.markdown.getMarkdown()),
  });

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  // Sync external value changes (e.g. after a server refresh) without clobbering
  // in-progress edits: only reset when the incoming value truly differs.
  useEffect(() => {
    if (!editor) return;
    const current = editor.storage.markdown.getMarkdown();
    if (value !== current) editor.commands.setContent(value ?? "", false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

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

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className="md-toolbar">
        <ToolButton icon={Heading1} title="Heading 1" active={editor?.isActive("heading", { level: 1 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} />
        <ToolButton icon={Heading2} title="Heading 2" active={editor?.isActive("heading", { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} />
        <ToolButton icon={Heading3} title="Heading 3" active={editor?.isActive("heading", { level: 3 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()} />
        <span className="md-toolbar-sep" />
        <ToolButton icon={Bold} title="Bold" active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()} />
        <ToolButton icon={Italic} title="Italic" active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()} />
        <ToolButton icon={Strikethrough} title="Strikethrough" active={editor?.isActive("strike")} onClick={() => editor?.chain().focus().toggleStrike().run()} />
        <ToolButton icon={Code} title="Inline code" active={editor?.isActive("code")} onClick={() => editor?.chain().focus().toggleCode().run()} />
        <span className="md-toolbar-sep" />
        <ToolButton icon={List} title="Bulleted list" active={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
        <ToolButton icon={ListOrdered} title="Numbered list" active={editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()} />
        <ToolButton icon={Quote} title="Quote" active={editor?.isActive("blockquote")} onClick={() => editor?.chain().focus().toggleBlockquote().run()} />
        <ToolButton icon={LinkGlyph} title="Link" active={editor?.isActive("link")} onClick={setLink} />
        <span className="md-toolbar-sep" />
        <ToolButton icon={ImageGlyph} title="Insert image" onClick={() => setPickerOpen(true)} />
      </div>
      <EditorContent editor={editor} className="blog-preview blog-editor" />
      {pickerOpen && (
        <ImagePicker
          title="Insert an image"
          onSelect={(image) => {
            editor?.chain().focus().setImage({ src: image.url, alt: image.alt }).run();
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

function ToolButton({
  icon: Icon,
  title,
  onClick,
  active,
}: {
  icon: ComponentType<{ size?: number | string }>;
  title: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button type="button" title={title} aria-label={title} aria-pressed={active} onClick={onClick} className="md-toolbar-btn">
      <Icon size={15} />
    </button>
  );
}
