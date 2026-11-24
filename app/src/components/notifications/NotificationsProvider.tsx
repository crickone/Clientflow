"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import type { NotificationKind } from "@/lib/notifications/model";

export interface BellItem {
  id: number;
  kind: NotificationKind;
  title: string;
  body: string;
  href: string;
  createdAt: number;
  unread: boolean;
}

interface Ctx {
  unread: number;
  items: BellItem[];
  loaded: boolean;
  open: (item: BellItem) => void;
  markAllRead: () => void;
  refresh: () => void;
}

const NotificationsContext = createContext<Ctx | null>(null);

export function useNotifications(): Ctx | null {
  return useContext(NotificationsContext);
}

const POLL_MS = 20_000;
/** More new ones than this at once become a single "N new notifications" pop-up. */
const MAX_TOASTS = 3;

/**
 * The bell's data, shared by the sidebar bell and the mobile top-bar bell so
 * there is one poller per tab. Polls every 20 seconds and on window focus,
 * only while the tab is visible. Anything newer than the last poll shows as a
 * pop-up with an Open action; the first load never pops up.
 *
 * `initial` + `poll={false}` render it from fixed data (the preview page).
 */
export function NotificationsProvider({
  children,
  initial,
  poll = true,
}: {
  children: React.ReactNode;
  initial?: { unread: number; items: BellItem[] };
  poll?: boolean;
}) {
  const router = useRouter();
  const [unread, setUnread] = useState(initial?.unread ?? 0);
  const [items, setItems] = useState<BellItem[]>(initial?.items ?? []);
  const [loaded, setLoaded] = useState(Boolean(initial));
  // Highest id seen so far; null until the first load, which never pops up.
  const seenMax = useRef<number | null>(initial ? Math.max(0, ...initial.items.map((i) => i.id)) : null);
  const inFlight = useRef(false);

  const markReadLocal = useCallback((id: number) => {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, unread: false } : i)));
    setUnread((n) => Math.max(0, n - 1));
  }, []);

  const open = useCallback(
    (item: BellItem) => {
      if (item.unread) {
        markReadLocal(item.id);
        if (poll) {
          void fetch("/api/notifications/read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: item.id }),
          }).catch(() => {});
        }
      }
      router.push(item.href);
    },
    [markReadLocal, poll, router],
  );

  const refresh = useCallback(async () => {
    if (!poll || inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as { ok?: boolean; unread?: number; items?: BellItem[] };
      if (!j.ok || !Array.isArray(j.items)) return;
      const list = j.items;
      const prev = seenMax.current;
      if (prev !== null) {
        const fresh = list.filter((i) => i.id > prev && i.unread);
        if (fresh.length > MAX_TOASTS) {
          toast(`${fresh.length} new notifications`, { description: fresh[0].title });
        } else {
          for (const i of fresh.slice().reverse()) {
            toast(i.title, { description: i.body || undefined, action: { label: "Open", onClick: () => open(i) } });
          }
        }
      }
      seenMax.current = Math.max(prev ?? 0, 0, ...list.map((i) => i.id));
      setItems(list);
      setUnread(j.unread ?? 0);
      setLoaded(true);
    } catch {
      // Offline or signed out: the next poll tries again.
    } finally {
      inFlight.current = false;
    }
  }, [open, poll]);

  useEffect(() => {
    if (!poll) return;
    void refresh();
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(tick, POLL_MS);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [poll, refresh]);

  const markAllRead = useCallback(() => {
    setItems((list) => list.map((i) => ({ ...i, unread: false })));
    setUnread(0);
    if (poll) {
      void fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      }).catch(() => {});
    }
  }, [poll]);

  const value = useMemo<Ctx>(
    () => ({ unread, items, loaded, open, markAllRead, refresh: () => void refresh() }),
    [unread, items, loaded, open, markAllRead, refresh],
  );
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
