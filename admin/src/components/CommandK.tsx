"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, FileText, Globe, Search, User } from "lucide-react";

import { STATIC_COMMANDS, pushRecent, rankStatic } from "@/lib/palette";
import type { SearchHit } from "@/lib/types";

const RECENT_KEY = "console.recent";
const ICON = { business: Building2, person: User, domain: Globe, invoice: FileText } as const;

type Row = { key: string; title: string; subtitle: string; href: string; icon: typeof Building2; hit?: SearchHit };

const KINDS = ["business", "person", "domain", "invoice"] as const;
const SEARCH_ERROR = "Search is unavailable. Sign in again if this keeps happening.";

function isRecentHit(v: unknown): v is SearchHit {
  if (typeof v !== "object" || v === null) return false;
  const h = v as { kind?: unknown; href?: unknown };
  return (KINDS as readonly unknown[]).includes(h.kind) && typeof h.href === "string" && h.href.startsWith("/");
}
function readRecent(): SearchHit[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isRecentHit) : [];
  } catch {
    return [];
  }
}
function writeRecent(list: SearchHit[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // private window or blocked storage: recents are a convenience only
  }
}

/**
 * Cmd+K / Ctrl+K / "/" opens it. Static pages rank first on a short query;
 * after 200ms of quiet the platform search runs and its hits follow.
 */
export function CommandK() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [recent, setRecent] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [searchError, setSearchError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("console:search", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("console:search", onOpen);
    };
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      setQ("");
      setHits([]);
      setSearchError(null);
      setActive(0);
      setRecent(readRecent());
      d.showModal();
      setTimeout(() => input.current?.focus(), 0);
    }
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      setSearchError(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (!res.ok) {
          setHits([]);
          setSearchError(SEARCH_ERROR);
          return;
        }
        const data = (await res.json()) as { hits: SearchHit[] };
        setSearchError(null);
        setHits(data.hits ?? []);
      } catch {
        // aborted or offline: keep what we have
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const statics: Row[] = rankStatic(q, STATIC_COMMANDS).map((c) => ({ key: `s:${c.href}`, title: c.title, subtitle: c.hint, href: c.href, icon: Search }));
  const dynamic: Row[] = (q.trim().length < 2 ? recent : hits).map((h) => ({ key: `${h.kind}:${h.id}:${h.href}`, title: h.title, subtitle: h.subtitle, href: h.href, icon: ICON[h.kind], hit: h }));
  const rows = [...dynamic, ...statics];
  const bounded = Math.min(active, Math.max(0, rows.length - 1));

  function go(row: Row) {
    if (row.hit) writeRecent(pushRecent(readRecent(), row.hit, 6));
    setOpen(false);
    router.push(row.href);
  }

  return (
    <dialog ref={dialog} className="palette" onClose={() => setOpen(false)} onClick={(e) => { if (e.target === dialog.current) setOpen(false); }}>
      <div className="palette-box" role="combobox" aria-expanded="true" aria-haspopup="listbox">
        <div className="palette-input">
          <Search size={16} strokeWidth={1.75} aria-hidden />
          <input
            ref={input}
            value={q}
            placeholder="Search businesses, people, domains, invoices…"
            aria-label="Search"
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === "Enter" && rows[bounded]) { e.preventDefault(); go(rows[bounded]); }
            }}
          />
          <kbd>esc</kbd>
        </div>
        <ul className="palette-list" role="listbox">
          {searchError && <li className="palette-empty">{searchError}</li>}
          {rows.length === 0 && !searchError && <li className="palette-empty">Nothing matches.</li>}
          {rows.map((row, i) => {
            const Icon = row.icon;
            return (
              <li
                key={row.key}
                role="option"
                aria-selected={i === bounded}
                className={i === bounded ? "is-active" : undefined}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(row)}
              >
                <Icon size={15} strokeWidth={1.75} aria-hidden />
                <span className="palette-title">{row.title}</span>
                <span className="palette-sub">{row.subtitle}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </dialog>
  );
}
