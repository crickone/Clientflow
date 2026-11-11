"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { SHORTCUTS, resolveShortcut } from "@/lib/shortcuts";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** Mounted once in the Shell. Chords time out after a second. */
export function Shortcuts() {
  const router = useRouter();
  const [help, setHelp] = useState(false);
  const prev = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector("dialog[open]:not(.shortcuts)")) return;
      const r = resolveShortcut(prev.current, e.key);
      if (timer.current) clearTimeout(timer.current);
      prev.current = null;
      if (r.kind === "pending") {
        prev.current = r.key;
        timer.current = setTimeout(() => (prev.current = null), 1000);
      } else if (r.kind === "go") {
        e.preventDefault();
        router.push(r.href);
      } else if (r.kind === "help") {
        e.preventDefault();
        setHelp((h) => !h);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (help && !d.open) d.showModal();
    if (!help && d.open) d.close();
  }, [help]);

  return (
    <dialog
      ref={dialog}
      className="dlg shortcuts"
      onClose={() => setHelp(false)}
      onClick={(e) => {
        if (e.target === dialog.current) setHelp(false);
      }}
    >
      <div className="dlg-body">
        <h2 className="dlg-title">Keyboard shortcuts</h2>
        <ul className="keys">
          {SHORTCUTS.map((s) => (
            <li key={s.keys}>
              <span>{s.label}</span>
              <kbd>{s.keys}</kbd>
            </li>
          ))}
        </ul>
      </div>
    </dialog>
  );
}
