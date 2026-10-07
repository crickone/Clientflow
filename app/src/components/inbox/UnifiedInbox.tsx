"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Bell,
  CheckCheck,
  CornerDownLeft,
  Inbox as InboxIcon,
  Layers,
  Mail,
  MailOpen,
  Plus,
  RefreshCw,
  Search,
  Tag,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { ChannelIcon } from "@/components/messaging/ChannelIcon";
import {
  contactContextAction,
  markThreadsReadAction,
  refreshInboxAction,
  type ContactContext,
} from "@/app/communication/actions";
import type { InboxChannel, InboxItem } from "@/lib/inbox/unified";
import { ContactPanel, ContactStrip, InboxAvatar } from "./ContactCard";
import { ConversationReader } from "./ConversationReader";
import { EmailReader } from "./EmailReader";
import { dayGroup, fullTime, listTime, type DayGroup } from "./format";

/**
 * The inbox: filters on the left, one list of every email thread and
 * WhatsApp / Messenger / Instagram conversation in the middle, and the open
 * one on the right with who the person is beside it. People come first;
 * automated mail and promotions sit in their own views.
 *
 * Keyboard: j / k move, x selects, r replies, e marks read, / searches,
 * Esc closes.
 */

type View = {
  key: string;
  label: string;
  icon: LucideIcon | null;
  channel?: InboxChannel;
  test: (i: InboxItem) => boolean;
  /** Show the number of matches rather than the unread count. */
  countAll?: boolean;
};

const PRIMARY: View[] = [
  { key: "inbox", label: "Inbox", icon: InboxIcon, test: (i) => i.bucket === "people" },
  { key: "unread", label: "Unread", icon: Mail, test: (i) => i.unread && i.bucket === "people", countAll: true },
  { key: "needs", label: "Needs reply", icon: CornerDownLeft, test: (i) => i.needsReply, countAll: true },
  { key: "all", label: "All messages", icon: Layers, test: () => true },
];
const SORTED: View[] = [
  { key: "notifications", label: "Notifications", icon: Bell, test: (i) => i.bucket === "notifications" },
  { key: "promotions", label: "Promotions", icon: Tag, test: (i) => i.bucket === "promotions" },
];
const CHANNEL_VIEWS: View[] = (
  [
    ["email", "Email"],
    ["whatsapp", "WhatsApp"],
    ["messenger", "Messenger"],
    ["instagram", "Instagram"],
  ] as const
).map(([channel, label]) => ({
  key: channel,
  label,
  icon: null,
  channel,
  test: (i: InboxItem) => i.channel === channel && i.bucket === "people",
}));
const ALL_VIEWS = [...PRIMARY, ...SORTED, ...CHANNEL_VIEWS];

const CHANNEL_NAME: Record<InboxChannel, string> = { email: "Email", whatsapp: "WhatsApp", messenger: "Messenger", instagram: "Instagram" };

const GROUP_ORDER: DayGroup[] = ["Today", "Yesterday", "This week", "Earlier"];

function matches(i: InboxItem, q: string) {
  const hay = `${i.name} ${i.address ?? ""} ${i.subject ?? ""} ${i.snippet}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

export function UnifiedInbox({
  items: initialItems,
  memberLabel,
  connectedEmail,
  emailMode,
  initialOpen,
  connected,
  isAdmin,
}: {
  items: InboxItem[];
  memberLabel: string;
  connectedEmail: string | null;
  emailMode: "two-way" | "sent-log";
  initialOpen: string | null;
  /** Which messaging channels this account has set up. */
  connected: { whatsapp: boolean; meta: boolean };
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  // A server refresh (Refresh, a sent reply) brings a new list; take it.
  useEffect(() => setItems(initialItems), [initialItems]);

  const [viewKey, setViewKey] = useState(() => {
    const open = initialItems.find((i) => i.key === initialOpen);
    return open && open.bucket !== "people" ? open.bucket : "inbox";
  });
  const [query, setQuery] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(
    initialOpen && initialItems.some((i) => i.key === initialOpen) ? initialOpen : null,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(openKey);
  const [replyToken, setReplyToken] = useState(0);
  const [ctx, setCtx] = useState<ContactContext | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const view = ALL_VIEWS.find((v) => v.key === viewKey) ?? PRIMARY[0];
  const visible = useMemo(
    () => (query.trim() ? items.filter((i) => matches(i, query)) : items.filter(view.test)),
    [items, query, view],
  );
  const openItem = items.find((i) => i.key === openKey) ?? null;

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const v of ALL_VIEWS) {
      const hits = items.filter(v.test);
      out[v.key] = v.countAll ? hits.length : hits.filter((i) => i.unread).length;
    }
    return out;
  }, [items]);
  // A channel gets a row once it has a conversation or is connected (so a
  // connected but quiet WhatsApp still shows, at zero).
  const presentChannels = useMemo(() => {
    const set = new Set(items.map((i) => i.channel));
    if (emailMode === "two-way") set.add("email");
    if (connected.whatsapp) set.add("whatsapp");
    if (connected.meta) {
      set.add("messenger");
      set.add("instagram");
    }
    return set;
  }, [items, emailMode, connected]);
  const connectLinks = [
    !connected.whatsapp && { href: "/settings/integrations/whatsapp", label: "Connect WhatsApp", channels: ["whatsapp"] as InboxChannel[] },
    !connected.meta && { href: "/settings/integrations/facebook", label: "Connect Facebook and Instagram", channels: ["messenger", "instagram"] as InboxChannel[] },
  ].filter(Boolean) as { href: string; label: string; channels: InboxChannel[] }[];

  const patch = useCallback((key: string, p: Partial<InboxItem>) => {
    setItems((all) => all.map((i) => (i.key === key ? { ...i, ...p } : i)));
  }, []);

  const open = useCallback((key: string) => {
    setOpenKey(key);
    setCursor(key);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("open", key);
      url.searchParams.delete("c");
      window.history.replaceState(null, "", url);
    } catch {
      /* ignore */
    }
  }, []);

  const close = useCallback(() => {
    setOpenKey(null);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("open");
      url.searchParams.delete("c");
      window.history.replaceState(null, "", url);
    } catch {
      /* ignore */
    }
  }, []);

  // Who the open person is, for the side card.
  useEffect(() => {
    if (!openItem) {
      setCtx(null);
      return;
    }
    let cancelled = false;
    setCtx(null);
    contactContextAction({ contact: openItem.contact, name: openItem.name, email: openItem.address }).then((c) => {
      if (!cancelled) setCtx(c);
    });
    return () => {
      cancelled = true;
    };
    // Re-fetch only when a different conversation opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openItem?.key]);

  async function markRead(keys: string[]) {
    const targets = items.filter((i) => keys.includes(i.key) && i.type === "email" && i.unread && i.threadId);
    if (targets.length === 0) return;
    setItems((all) => all.map((i) => (targets.some((t) => t.key === i.key) ? { ...i, unread: false } : i)));
    const res = await markThreadsReadAction(targets.map((t) => t.threadId!));
    if (!res.ok) toast.error(res.error);
  }

  function refresh() {
    startRefresh(async () => {
      const res = await refreshInboxAction();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
      toast.success(res.synced > 0 ? `${res.synced} new message${res.synced === 1 ? "" : "s"}` : "Up to date");
    });
  }

  function toggleSelect(key: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  // Keyboard shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        if (isTyping(e.target)) (e.target as HTMLElement).blur();
        else if (selected.size) setSelected(new Set());
        else if (openKey) close();
        return;
      }
      if (isTyping(e.target)) return;
      // Leave keys alone while a dialog (Cmd+K, a confirm) is open.
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      const idx = visible.findIndex((i) => i.key === cursor);
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = visible[Math.min(visible.length - 1, idx + 1)];
        if (next) open(next.key);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = visible[Math.max(0, idx - 1)];
        if (prev) open(prev.key);
      } else if (e.key === "x" && cursor) {
        toggleSelect(cursor);
      } else if (e.key === "r" && openKey) {
        e.preventDefault();
        setReplyToken((n) => n + 1);
      } else if (e.key === "e") {
        markRead(selected.size ? [...selected] : openKey ? [openKey] : []);
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Keep the highlighted row in view as the keyboard moves it.
  useEffect(() => {
    if (!cursor) return;
    listRef.current?.querySelector(`[data-key="${CSS.escape(cursor)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const groups = useMemo(() => {
    const now = Date.now();
    const by = new Map<DayGroup, InboxItem[]>();
    for (const i of visible) {
      const g = dayGroup(i.at, now);
      by.set(g, [...(by.get(g) ?? []), i]);
    }
    return GROUP_ORDER.filter((g) => by.has(g)).map((g) => [g, by.get(g)!] as const);
  }, [visible]);

  const selectedEmailsUnread = items.filter((i) => selected.has(i.key) && i.type === "email" && i.unread).length;
  const viewUnreadEmails = visible.filter((i) => i.type === "email" && i.unread);

  function setView(key: string) {
    setViewKey(key);
    setQuery("");
    setSelected(new Set());
  }

  const railItem = (v: View) => {
    const n = counts[v.key];
    return (
      <button
        key={v.key}
        type="button"
        className="inbox-rail-item"
        aria-current={!query && viewKey === v.key ? "page" : undefined}
        onClick={() => setView(v.key)}
      >
        {v.channel ? <ChannelIcon channel={v.channel} size={16} /> : v.icon ? <v.icon size={16} strokeWidth={1.75} /> : null}
        <span className="inbox-rail-label-text">{v.label}</span>
        {n > 0 && <span className="inbox-rail-count">{n > 999 ? "999+" : n}</span>}
      </button>
    );
  };

  return (
    <div className="inbox" data-open={openItem ? "true" : undefined}>
      {/* Filters */}
      <nav className="inbox-rail" aria-label="Inbox views">
        {PRIMARY.map(railItem)}
        <div className="inbox-rail-heading">Sorted for you</div>
        {SORTED.map(railItem)}
        <div className="inbox-rail-heading">Channels</div>
        {CHANNEL_VIEWS.filter((v) => presentChannels.has(v.channel!)).map(railItem)}
        {connectLinks.map((c) => (
          <ConnectLink key={c.href} {...c} isAdmin={isAdmin} />
        ))}
        <div className="inbox-rail-foot">
          {emailMode === "two-way" && connectedEmail ? (
            <>
              <span title={connectedEmail}>{connectedEmail}</span>
              <button type="button" className="inbox-icon-btn" onClick={refresh} disabled={refreshing} aria-label="Check for new email">
                <RefreshCw size={14} className={refreshing ? "spin" : undefined} />
              </button>
            </>
          ) : (
            <Link href="/settings/email" className="inbox-link">
              Connect your email <ArrowUpRight size={13} />
            </Link>
          )}
        </div>
      </nav>

      {/* List */}
      <section className="inbox-list" aria-label="Messages">
        <div className="inbox-list-head">
          {selected.size > 0 ? (
            <div className="inbox-bulk">
              <button type="button" className="inbox-icon-btn" onClick={() => setSelected(new Set())} aria-label="Clear selection">
                <X size={15} />
              </button>
              <span>{selected.size} selected</span>
              <Button size="sm" variant="outline" disabled={!selectedEmailsUnread} onClick={() => { markRead([...selected]); setSelected(new Set()); }}>
                <MailOpen size={14} /> Mark read
              </Button>
            </div>
          ) : (
            <div className="inbox-search">
              <Search size={15} />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search all messages"
                aria-label="Search all messages"
              />
              {query && (
                <button type="button" className="inbox-icon-btn" onClick={() => setQuery("")} aria-label="Clear search">
                  <X size={14} />
                </button>
              )}
            </div>
          )}
          <div className="inbox-list-sub">
            {/* Phones have no rail; the views live in this menu instead. */}
            <select className="inbox-view-select" value={viewKey} onChange={(e) => setView(e.target.value)} aria-label="View">
              {ALL_VIEWS.filter((v) => !v.channel || presentChannels.has(v.channel)).map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
                  {counts[v.key] ? ` (${counts[v.key]})` : ""}
                </option>
              ))}
            </select>
            <span className="inbox-list-title">{query ? "Search results" : view.label}</span>
            {viewUnreadEmails.length > 0 && !query && (
              <button type="button" className="inbox-text-btn" onClick={() => markRead(viewUnreadEmails.map((i) => i.key))}>
                <CheckCheck size={14} /> Mark all read
              </button>
            )}
          </div>
        </div>

        <div className="inbox-list-scroll" ref={listRef}>
          {visible.length === 0 ? (
            <div className="inbox-empty">
              <div className="wempty-art" aria-hidden>
                <span className="wempty-ring wempty-ring--2" />
                <span className="wempty-ring" />
                <span className="wempty-mark">{query ? <Search size={17} strokeWidth={1.6} /> : <CheckCheck size={17} strokeWidth={1.6} />}</span>
              </div>
              <div className="wempty-text">
                {query ? `Nothing matches "${query}".` : viewKey === "needs" ? "Nothing waiting on a reply." : viewKey === "unread" ? "All caught up." : "Nothing here yet."}
              </div>
            </div>
          ) : (
            groups.map(([group, rows]) => (
              <div key={group} role="group" aria-label={group}>
                <div className="inbox-group">{group}</div>
                {rows.map((i) => (
                  <Row
                    key={i.key}
                    item={i}
                    memberLabel={memberLabel}
                    active={i.key === openKey}
                    cursor={i.key === cursor}
                    checked={selected.has(i.key)}
                    selecting={selected.size > 0}
                    onOpen={() => open(i.key)}
                    onCheck={() => toggleSelect(i.key)}
                  />
                ))}
              </div>
            ))
          )}
        </div>
        {/* Phones and tablets have no rail, so the connect links sit here. */}
        {connectLinks.length > 0 && (
          <div className="inbox-list-connect">
            {connectLinks.map((c) => (
              <ConnectLink key={c.href} {...c} isAdmin={isAdmin} />
            ))}
          </div>
        )}
        <div className="inbox-keys" aria-hidden>
          <kbd>j</kbd>
          <kbd>k</kbd> move <kbd>r</kbd> reply <kbd>e</kbd> mark read <kbd>/</kbd> search
        </div>
      </section>

      {/* Reading pane */}
      <section className="inbox-reader" aria-label="Conversation">
        {!openItem ? (
          <div className="inbox-reader-empty">
            <div className="wempty-art" aria-hidden>
              <span className="wempty-ring wempty-ring--2" />
              <span className="wempty-ring" />
              <span className="wempty-mark">
                <InboxIcon size={17} strokeWidth={1.6} />
              </span>
            </div>
            <div className="inbox-reader-empty-title">
              {counts.needs > 0 ? `${counts.needs} waiting on a reply` : "You're all caught up"}
            </div>
            <div className="wempty-text">
              {counts.inbox > 0 ? `${counts.inbox} unread in your inbox. ` : ""}Pick a message to read it here.
            </div>
            {counts.needs > 0 && (
              <Button size="sm" variant="outline" onClick={() => setView("needs")}>
                <CornerDownLeft size={14} /> Show what needs a reply
              </Button>
            )}
            {connectLinks.length > 0 && (
              <div className="inbox-connect-cta">
                <p>
                  {connectLinks.length === 2
                    ? "Connect WhatsApp, Facebook and Instagram to answer every message here."
                    : `${connectLinks[0].label} to answer those messages here too.`}
                </p>
                {isAdmin ? (
                  <div className="inbox-connect-cta-buttons">
                    {connectLinks.map((c) => (
                      <Link key={c.href} href={c.href}>
                        <Button size="sm" variant="outline">
                          <span className="inbox-connect-icons">
                            {c.channels.map((ch) => (
                              <ChannelIcon key={ch} channel={ch} size={15} />
                            ))}
                          </span>
                          {c.label}
                        </Button>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="inbox-connect-note">An admin on this account can connect them in Settings.</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="inbox-reader-inner">
            <div className="inbox-reader-main">
              <header className="inbox-reader-head">
                <button type="button" className="inbox-icon-btn inbox-back" onClick={close} aria-label="Back to the list">
                  <ArrowLeft size={17} />
                </button>
                <InboxAvatar name={openItem.name} size={36} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="inbox-reader-name">{openItem.name}</div>
                  <div className="inbox-reader-meta">
                    <ChannelIcon channel={openItem.channel} size={13} />
                    <span>{openItem.address ?? CHANNEL_NAME[openItem.channel]}</span>
                  </div>
                </div>
                <button type="button" className="inbox-icon-btn inbox-close" onClick={close} aria-label="Close">
                  <X size={16} />
                </button>
              </header>
              <ContactStrip
                ctx={ctx}
                memberLabel={memberLabel}
                canAddLead={openItem.bucket === "people"}
                onAdded={(leadId) => {
                  patch(openItem.key, { contact: { type: "lead", id: leadId } });
                  contactContextAction({ contact: { type: "lead", id: leadId }, name: openItem.name, email: openItem.address }).then(setCtx);
                }}
              />
              {openItem.type === "email" && openItem.threadId ? (
                <EmailReader
                  threadId={openItem.threadId}
                  expectReply={openItem.bucket === "people"}
                  focusReplyToken={replyToken}
                  onLoaded={() => patch(openItem.key, { unread: false })}
                />
              ) : openItem.type === "conversation" && openItem.conv ? (
                <ConversationReader
                  kind={openItem.conv.kind}
                  contactId={openItem.conv.contactId}
                  focusReplyToken={replyToken}
                  onSent={(text, channel) =>
                    patch(openItem.key, { snippet: `You: ${text}`, outbound: true, at: Date.now(), unread: false, needsReply: false, channel })
                  }
                />
              ) : (
                <SentEmail item={openItem} />
              )}
            </div>
            <ContactPanel
              ctx={ctx}
              memberLabel={memberLabel}
              canAddLead={openItem.bucket === "people"}
              onAdded={(leadId) => {
                patch(openItem.key, { contact: { type: "lead", id: leadId } });
                contactContextAction({ contact: { type: "lead", id: leadId }, name: openItem.name, email: openItem.address }).then(setCtx);
              }}
            />
          </div>
        )}
      </section>
    </div>
  );
}

/** A rail row for a channel this account has not set up yet. */
function ConnectLink({ href, label, channels, isAdmin }: { href: string; label: string; channels: InboxChannel[]; isAdmin: boolean }) {
  const inner = (
    <>
      <span className="inbox-connect-icons">
        {channels.map((ch) => (
          <ChannelIcon key={ch} channel={ch} size={16} />
        ))}
      </span>
      <span className="inbox-rail-label-text">{label}</span>
      {isAdmin && <Plus size={14} className="inbox-connect-plus" />}
    </>
  );
  return isAdmin ? (
    <Link href={href} className="inbox-rail-item inbox-rail-connect">
      {inner}
    </Link>
  ) : (
    <span className="inbox-rail-item inbox-rail-connect is-static" title="An admin can connect this in Settings">
      {inner}
    </span>
  );
}

function Row({
  item: i,
  memberLabel,
  active,
  cursor,
  checked,
  selecting,
  onOpen,
  onCheck,
}: {
  item: InboxItem;
  memberLabel: string;
  active: boolean;
  cursor: boolean;
  checked: boolean;
  selecting: boolean;
  onOpen: () => void;
  onCheck: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-key={i.key}
      className={`inbox-row${i.unread ? " is-unread" : ""}${cursor && !active ? " is-cursor" : ""}${selecting ? " is-selecting" : ""}`}
      aria-current={active ? "true" : undefined}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
    >
      <span className="inbox-row-lead">
        <span className="inbox-row-avatar">
          <InboxAvatar name={i.name} size={34} />
          <span className="inbox-row-channel">
            <ChannelIcon channel={i.channel} size={14} />
          </span>
        </span>
        <label className="inbox-row-check" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={checked} onChange={onCheck} aria-label={`Select ${i.name}`} />
        </label>
      </span>
      <span className="inbox-row-body">
        <span className="inbox-row-top">
          <span className="inbox-row-name">{i.name}</span>
          {i.messageCount > 1 && <span className="inbox-row-n">{i.messageCount}</span>}
          <span className="inbox-row-time">{listTime(i.at)}</span>
        </span>
        {i.subject && <span className="inbox-row-subject">{i.subject}</span>}
        <span className="inbox-row-snippet">{i.snippet || " "}</span>
        {(i.contact || i.failed || i.conv?.aiPriority === "high") && (
          <span className="inbox-row-chips">
            {i.contact && <span className={`inbox-pill inbox-pill--${i.contact.type}`}>{i.contact.type === "client" ? memberLabel : "Lead"}</span>}
            {i.conv?.aiPriority === "high" && <span className="inbox-pill inbox-pill--urgent">Urgent</span>}
            {i.failed && <span className="inbox-pill inbox-pill--urgent">Not sent</span>}
          </span>
        )}
      </span>
      {i.unread && <span className="inbox-row-dot" aria-label="Unread" />}
    </div>
  );
}

function SentEmail({ item }: { item: InboxItem }) {
  return (
    <div className="inbox-reader-body">
      <div className="inbox-reader-scroll">
        <h2 className="inbox-subject">{item.subject || "(no subject)"}</h2>
        <article className="inbox-msg is-open">
          <div className="inbox-msg-head" style={{ cursor: "default" }}>
            <InboxAvatar name="You" size={30} />
            <span className="inbox-msg-from">
              <strong>You</strong>
              <span>to {item.address}</span>
            </span>
            <span className="inbox-msg-time">{fullTime(item.at)}</span>
          </div>
          <div className="inbox-msg-text">{item.body ?? item.snippet}</div>
        </article>
        {item.failed && <p className="inbox-flag inbox-flag--danger" style={{ marginTop: 12 }}>This email was not delivered.</p>}
      </div>
    </div>
  );
}
