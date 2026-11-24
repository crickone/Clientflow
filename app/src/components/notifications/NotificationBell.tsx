"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Bell, CalendarCheck, CheckCheck, CreditCard, MessageCircle, Settings2, UserPlus, type LucideIcon } from "lucide-react";

import { badgeText, timeAgo, type NotificationKind } from "@/lib/notifications/model";
import { useNotifications } from "./NotificationsProvider";

const KIND_ICON: Record<NotificationKind, LucideIcon> = {
  message: MessageCircle,
  lead: UserPlus,
  sale: CreditCard,
  booking: CalendarCheck,
};

/**
 * The bell: unread count, and a panel with the latest 30. Clicking one marks
 * it read and opens it. Two are mounted (sidebar on desktop, top bar on
 * phones; CSS shows one), both reading the one NotificationsProvider.
 */
export function NotificationBell({
  placement,
  defaultOpen,
}: {
  placement: "sidebar" | "topbar";
  /** Preview page only. */
  defaultOpen?: boolean;
}) {
  const ctx = useNotifications();
  // Relative times are worked out after mount so the server render matches.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), [ctx?.items]);
  if (!ctx) return null;
  const { unread, items, loaded, open, markAllRead } = ctx;
  const badge = badgeText(unread);
  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";

  return (
    <Menu.Root defaultOpen={defaultOpen} modal={false} onOpenChange={(o) => o && setNow(Date.now())}>
      <Menu.Trigger asChild>
        <button type="button" className={`nt-bell nt-bell--${placement}`} aria-label={label}>
          <Bell size={placement === "topbar" ? 19 : 15} strokeWidth={1.9} aria-hidden />
          {badge && (
            <span className="nt-badge" aria-hidden>
              {badge}
            </span>
          )}
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className="nt-panel"
          side={placement === "sidebar" ? "right" : "bottom"}
          align={placement === "sidebar" ? "start" : "end"}
          sideOffset={8}
          collisionPadding={12}
          loop
        >
          <div className="nt-head">
            <span className="nt-head-title">Notifications</span>
            <Menu.Item
              className="nt-head-btn"
              disabled={unread === 0}
              onSelect={(e) => {
                e.preventDefault();
                markAllRead();
              }}
            >
              <CheckCheck size={14} aria-hidden />
              Mark all as read
            </Menu.Item>
          </div>
          <div className="nt-list">
            {items.length === 0 ? (
              <p className="nt-empty">{loaded ? "Nothing yet. New messages, leads and bookings show here." : "Loading..."}</p>
            ) : (
              items.map((i) => {
                const Icon = KIND_ICON[i.kind] ?? Bell;
                return (
                  <Menu.Item key={i.id} className={`nt-item${i.unread ? " is-unread" : ""}`} onSelect={() => open(i)}>
                    <span className={`nt-icon nt-icon--${i.kind}`} aria-hidden>
                      <Icon size={15} strokeWidth={1.9} />
                    </span>
                    <span className="nt-text">
                      <span className="nt-title">{i.title}</span>
                      {i.body && <span className="nt-body">{i.body}</span>}
                      <span className="nt-time">{now ? timeAgo(i.createdAt, now) : ""}</span>
                    </span>
                    {i.unread && <span className="nt-dot" aria-label="Unread" />}
                  </Menu.Item>
                );
              })
            )}
          </div>
          <Menu.Item asChild className="nt-foot">
            <Link href="/settings/notifications">
              <Settings2 size={14} aria-hidden />
              Notification settings
            </Link>
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
