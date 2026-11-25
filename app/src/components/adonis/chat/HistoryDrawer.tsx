"use client";

import "./chat.css";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Plus, Search, Trash2, X } from "lucide-react";

import { EASE } from "@/lib/motion";
import type { ConversationSummary } from "@/lib/agents/conversationModel";
import { filterHistory, groupHistory, historyTimeLabel } from "./history";

export type HistoryDrawerProps = {
  open: boolean;
  onClose: () => void;
  items: ConversationSummary[];
  activeId: string;
  onOpen: (id: string) => void;
  onNew: () => void;
  /** Called when the delete button is pressed; the page confirms first. */
  onDelete: (id: string) => void;
  /** For screenshots with fixed data; defaults to the current time. */
  now?: number;
};

/**
 * Chats, from the right: search, New chat, grouped by Irish day (Today /
 * Yesterday / Earlier), a live "Working" tag on chats Adonis is still
 * working in. Full width on a phone.
 *
 * Portalled to document.body (the app shell's page transition uses
 * transforms, which would trap a fixed element), inside its own
 * `.ax-root.ax-portal` wrapper so the chat's colour tokens still apply.
 */
export function HistoryDrawer({ open, onClose, items, activeId, onOpen, onNew, onDelete, now }: HistoryDrawerProps) {
  const reduced = useReducedMotion() ?? false;
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const focus = setTimeout(() => searchRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(focus);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!mounted) return null;
  const at = now ?? Date.now();
  const groups = groupHistory(filterHistory(items, query), at);
  const t = { duration: reduced ? 0 : 0.28, ease: EASE };

  return createPortal(
    <div className="ax-root ax-portal">
      <AnimatePresence>
        {open && (
          <>
            <motion.div key="scrim" className="ax-scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={t} />
            <motion.aside
              key="drawer"
              className="ax-drawer"
              role="dialog"
              aria-modal="true"
              aria-label="Chats"
              initial={{ x: reduced ? 0 : "100%" }}
              animate={{ x: 0 }}
              exit={{ x: reduced ? 0 : "100%" }}
              transition={t}
            >
              <div className="ax-drawer-top">
                <b>Chats</b>
                <div className="ax-drawer-actions">
                  <button type="button" className="ax-new" onClick={onNew}>
                    <Plus size={14} strokeWidth={2} aria-hidden />
                    New chat
                  </button>
                  <button type="button" className="ax-ic" onClick={onClose} aria-label="Close chats">
                    <X size={16} strokeWidth={1.9} />
                  </button>
                </div>
              </div>
              <label className="ax-search">
                <Search size={14} strokeWidth={1.9} aria-hidden />
                <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search chats" />
              </label>
              <div className="ax-hlist">
                {groups.length === 0 ? (
                  <div className="ax-empty-list">{query.trim() ? "No chats match that." : "No chats yet."}</div>
                ) : (
                  groups.map((g) => (
                    <section key={g.label} aria-label={g.label}>
                      <div className="ax-grp">{g.label}</div>
                      {g.items.map((c) => (
                        <div key={c.id} className="ax-hi" data-active={c.id === activeId}>
                          <button type="button" className="ax-hi-open" onClick={() => onOpen(c.id)} aria-current={c.id === activeId ? "true" : undefined}>
                            <span className="ax-hi-title">{c.title || "Untitled"}</span>
                            {c.running ? <span className="ax-live">Working</span> : <span className="ax-hi-time">{historyTimeLabel(c.updatedAt, at)}</span>}
                          </button>
                          {!c.running && (
                            <button type="button" className="ax-hi-del" onClick={() => onDelete(c.id)} aria-label={`Delete ${c.title || "this chat"}`}>
                              <Trash2 size={14} strokeWidth={1.9} />
                            </button>
                          )}
                        </div>
                      ))}
                    </section>
                  ))
                )}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
