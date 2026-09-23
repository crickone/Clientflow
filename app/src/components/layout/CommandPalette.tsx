"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Search } from "lucide-react";

import { ADONIS_LINK, DASHBOARD_LINK, NAV_GROUPS } from "./Sidebar";
import { buildCommands, filterCommands, type CommandContext } from "@/lib/ui/commands";
import { SHORTCUTS } from "@/lib/ui/shortcuts";

/**
 * Cmd+K. Every destination the sidebar would show this user, searchable.
 *
 * Indexed from the sidebar's own nav tree rather than a second list, and
 * filtered through the same gates — admin-only, scheduling mode, per-tenant
 * modules, feature flags. See @/lib/ui/commands for why that matters.
 *
 * Opening and closing is owned by CommandK, which holds the one window
 * listener; this component is only the surface.
 *
 * It is a real Radix dialog rather than a hand-rolled overlay, because it has
 * to open ON TOP of one. A Radix modal — a dialog, a sheet, a dropdown — sets
 * `pointer-events: none` on the body and traps focus inside itself, so a plain
 * sibling div opened over it could not be clicked and lost its input focus on
 * the next tick: Cmd+K looked broken on any screen with a panel open. Mounting
 * our own dialog pauses the one underneath and inherits Radix's Escape,
 * click-outside and focus handling instead of re-implementing them.
 */
export function CommandPalette({
  open,
  onClose,
  ctx,
  showHelp,
}: {
  open: boolean;
  onClose: () => void;
  ctx: CommandContext;
  /** True when opened with `?` — the same surface, listing shortcuts instead. */
  showHelp: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const commands = useMemo(() => {
    const flat = buildCommands([ADONIS_LINK, DASHBOARD_LINK, ...NAV_GROUPS], ctx);
    // De-duplicate by href: a destination that appears in two groups should be
    // one row, not two identical ones the user has to choose between.
    const seen = new Set<string>();
    return flat.filter((c) => (seen.has(c.href) ? false : (seen.add(c.href), true)));
  }, [ctx]);

  const results = useMemo(() => filterCommands(commands, query), [commands, query]);

  // A fresh query every time it opens: the palette is for jumping, and a stale
  // query from twenty minutes ago is a puzzle, not a shortcut.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => setActive(0), [query]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function go(index: number) {
    const cmd = results[index];
    if (!cmd) return;
    onClose();
    router.push(cmd.href);
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="cmdk-backdrop" />
        <DialogPrimitive.Content className="cmdk" aria-describedby={undefined}>
          <DialogPrimitive.Title className="sr-only">
            {showHelp ? "Keyboard shortcuts" : "Command palette"}
          </DialogPrimitive.Title>
          {showHelp ? (
            <>
              <p className="cmdk-heading">Keyboard shortcuts</p>
              <ul className="cmdk-keys">
                {SHORTCUTS.map((s) => (
                  <li key={s.keys}>
                    <kbd>{s.keys}</kbd>
                    <span>{s.does}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <div className="cmdk-field">
                <Search size={15} aria-hidden />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Go to…"
                  aria-label="Search pages"
                  role="combobox"
                  aria-expanded
                  aria-controls="cmdk-list"
                  aria-activedescendant={results[active] ? `cmdk-opt-${active}` : undefined}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setActive((i) => (results.length ? (i + 1) % results.length : 0));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      go(active);
                    }
                  }}
                />
              </div>

              {results.length === 0 ? (
                <p className="cmdk-empty">Nothing matches “{query}”.</p>
              ) : (
                <ul className="cmdk-list" id="cmdk-list" role="listbox" ref={listRef}>
                  {results.map((cmd, i) => (
                    <li
                      key={cmd.href}
                      id={`cmdk-opt-${i}`}
                      role="option"
                      aria-selected={i === active}
                      className={i === active ? "is-active" : undefined}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(i)}
                    >
                      <span className="cmdk-label">{cmd.label}</span>
                      {cmd.group ? <span className="cmdk-group">{cmd.group}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          <div className="cmdk-foot">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> move
            </span>
            <span>
              <kbd>↵</kbd> open
            </span>
            <span>
              <kbd>esc</kbd> close
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
