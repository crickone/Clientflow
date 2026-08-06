"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  AlertTriangle,
  Sparkles,
  Check,
  Pencil,
  X,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConversationThread, type ThreadMessage } from "./ConversationThread";
import {
  loadThreadAction,
  sendInboxMessageAction,
  retriageAction,
} from "@/app/communication/actions";
import type {
  ConversationDetail,
  ConversationSummary,
} from "@/lib/conversations";
import { relativeTime, initialsOf } from "@/lib/utils";

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  new_lead: { label: "New lead", color: "#3fb950" },
  booking: { label: "Booking", color: "#58a6ff" },
  existing_client: { label: "Client", color: "#a855f7" },
  faq: { label: "FAQ", color: "#2ed8c3" },
  sensitive: { label: "Sensitive", color: "#f85149" },
  spam: { label: "Spam", color: "#8b949e" },
  other: { label: "Other", color: "#8b949e" },
};

const PRIORITY_COLOR: Record<string, string> = {
  high: "#f85149",
  normal: "#d29922",
  low: "#8b949e",
};

function keyOf(c: { kind: string; contactId: number }) {
  return `${c.kind}-${c.contactId}`;
}

function convInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return initialsOf(parts[0] ?? "", parts[1] ?? "");
}

function PriorityDot({ priority }: { priority: string | null }) {
  if (!priority) return null;
  return (
    <span
      title={`${priority} priority`}
      style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: PRIORITY_COLOR[priority] ?? "var(--text-tertiary)",
        flexShrink: 0,
      }}
    />
  );
}

export function InboxClient({
  conversations,
  memberLabel,
}: {
  conversations: ConversationSummary[];
  memberLabel: string;
}) {
  const [items, setItems] = useState<ConversationSummary[]>(conversations);
  const [selectedKey, setSelectedKey] = useState<string | null>(
    conversations[0] ? keyOf(conversations[0]) : null,
  );
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, startSend] = useTransition();
  const [retriaging, startRetriage] = useTransition();

  // Filters
  const [catFilter, setCatFilter] = useState("");
  const [prioFilter, setPrioFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [needsOnly, setNeedsOnly] = useState(false);

  // AI draft handling for the selected conversation
  const [draftDismissed, setDraftDismissed] = useState(false);
  const [seedText, setSeedText] = useState<string | undefined>(undefined);

  const allTags = useMemo(
    () =>
      [...new Set(items.flatMap((c) => c.tags.map((t) => t.label)))].sort(),
    [items],
  );

  const filtered = useMemo(
    () =>
      items.filter((c) => {
        if (catFilter && c.aiCategory !== catFilter) return false;
        if (prioFilter && c.aiPriority !== prioFilter) return false;
        if (tagFilter && !c.tags.some((t) => t.label === tagFilter))
          return false;
        if (needsOnly && !c.needsAttention) return false;
        return true;
      }),
    [items, catFilter, prioFilter, tagFilter, needsOnly],
  );

  const selected = useMemo(
    () => items.find((c) => keyOf(c) === selectedKey) ?? null,
    [items, selectedKey],
  );

  // Load the selected conversation's full thread.
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingThread(true);
    setDetail(null);
    setDraftDismissed(false);
    setSeedText(undefined);
    loadThreadAction(selected.kind, selected.contactId).then((res) => {
      if (cancelled) return;
      setLoadingThread(false);
      if (res.ok) setDetail(res.detail);
      else toast.error(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  function handleSend(text: string, fromDraft = false) {
    if (!selected) return;
    const { kind, contactId } = selected;
    startSend(async () => {
      const res = await sendInboxMessageAction(kind, contactId, text);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const now = new Date();
      const sent: ThreadMessage = {
        id: res.messageId,
        direction: "outbound",
        channel: "whatsapp",
        content: text,
        status: "sent",
        sentAt: now,
        createdAt: now,
      };
      setDetail((prev) =>
        prev ? { ...prev, messages: [...prev.messages, sent], draft: null } : prev,
      );
      // Clear the suggestion once sent; a fresh one appears on the next inbound message.
      setDraftDismissed(true);
      // Bump the left-pane preview; clear the needs-you flag.
      setItems((prev) =>
        prev.map((c) =>
          keyOf(c) === keyOf({ kind, contactId })
            ? {
                ...c,
                lastMessage: text,
                lastDirection: "outbound" as const,
                lastAt: now,
                channel: "whatsapp",
                needsAttention: false,
              }
            : c,
        ),
      );
      toast.success(fromDraft ? "AI reply approved & sent." : "Sent via WhatsApp.");
    });
  }

  function retriage() {
    if (!selected) return;
    const { kind, contactId } = selected;
    startRetriage(async () => {
      const res = await retriageAction(kind, contactId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const t = await loadThreadAction(kind, contactId);
      if (t.ok) setDetail(t.detail);
      toast.success("Re-triaged.");
    });
  }

  const showDraft = !!detail?.draft && !draftDismissed;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Filter bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <FilterSelect
          value={catFilter}
          onChange={setCatFilter}
          placeholder="All categories"
          options={Object.entries(CATEGORY_META).map(([v, m]) => ({
            value: v,
            label: m.label,
          }))}
        />
        <FilterSelect
          value={prioFilter}
          onChange={setPrioFilter}
          placeholder="Any priority"
          options={[
            { value: "high", label: "High" },
            { value: "normal", label: "Normal" },
            { value: "low", label: "Low" },
          ]}
        />
        {allTags.length > 0 && (
          <FilterSelect
            value={tagFilter}
            onChange={setTagFilter}
            placeholder="Any tag"
            options={allTags.map((t) => ({ value: t, label: t }))}
          />
        )}
        <button
          onClick={() => setNeedsOnly((v) => !v)}
          style={{
            padding: "7px 12px",
            fontSize: 12,
            borderRadius: "var(--radius)",
            border: `1px solid ${needsOnly ? "var(--accent)" : "var(--hairline)"}`,
            background: needsOnly ? "var(--accent-soft)" : "transparent",
            color: needsOnly ? "var(--accent)" : "var(--text-secondary)",
            cursor: "pointer",
          }}
        >
          Needs you
        </button>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 12,
            color: "var(--text-tertiary)",
          }}
        >
          {filtered.length} of {items.length}
        </span>
      </div>

      <div
        className="inbox-split"
        style={{
          display: "flex",
          height: "calc(100vh - 300px)",
          minHeight: 460,
          border: "1px solid var(--grid)",
          background: "var(--surface-1)",
        }}
      >
        {/* Left: conversation list */}
        <div
          className="inbox-list"
          style={{
            width: 340,
            flexShrink: 0,
            borderRight: "1px solid var(--grid)",
            overflowY: "auto",
          }}
        >
          {filtered.length === 0 ? (
            <div
              style={{
                padding: 24,
                color: "var(--text-tertiary)",
                fontSize: 13,
              }}
            >
              No conversations match these filters.
            </div>
          ) : (
            filtered.map((c) => {
              const isSel = keyOf(c) === selectedKey;
              const cat = c.aiCategory ? CATEGORY_META[c.aiCategory] : null;
              return (
                <button
                  key={keyOf(c)}
                  onClick={() => setSelectedKey(keyOf(c))}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    width: "100%",
                    textAlign: "left",
                    padding: "14px 16px",
                    border: "none",
                    borderBottom: "1px solid var(--grid)",
                    borderLeft: `2px solid ${isSel ? "var(--accent)" : "transparent"}`,
                    background: isSel ? "var(--accent-soft)" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <Avatar initials={convInitials(c.name)} size={38} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        justifyContent: "space-between",
                      }}
                    >
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          minWidth: 0,
                        }}
                      >
                        <PriorityDot priority={c.aiPriority} />
                        <span
                          style={{
                            color: "var(--text-primary)",
                            fontWeight: 500,
                            fontSize: 13.5,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {c.name}
                        </span>
                        {c.needsAttention && (
                          <span
                            title="Needs you"
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background: "var(--accent)",
                              flexShrink: 0,
                            }}
                          />
                        )}
                      </span>
                      <span
                        style={{
                          color: "var(--text-tertiary)",
                          fontSize: 10,
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        {relativeTime(c.lastAt)}
                      </span>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        marginTop: 4,
                        flexWrap: "wrap",
                      }}
                    >
                      <Badge>{c.kind === "client" ? memberLabel : "Lead"}</Badge>
                      {cat && <Badge colour={cat.color}>{cat.label}</Badge>}
                    </div>

                    <div
                      style={{
                        color: "var(--text-tertiary)",
                        fontSize: 12,
                        marginTop: 4,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.aiSummary ||
                        `${c.lastDirection === "inbound" ? "" : "You: "}${c.lastMessage}`}
                    </div>

                    {c.tags.length > 0 && (
                      <div
                        style={{
                          display: "flex",
                          gap: 4,
                          marginTop: 5,
                          flexWrap: "wrap",
                        }}
                      >
                        {c.tags.slice(0, 3).map((t) => (
                          <Badge key={t.label} colour={t.color ?? undefined}>
                            {t.label}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Right: selected thread + compose */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            overflowY: "auto",
          }}
        >
          {!selected ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-tertiary)",
                fontSize: 14,
              }}
            >
              Select a conversation to read and reply.
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "16px 24px",
                  borderBottom: "1px solid var(--grid)",
                  position: "sticky",
                  top: 0,
                  background: "var(--surface-1)",
                  zIndex: 1,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    minWidth: 0,
                  }}
                >
                  <Avatar initials={convInitials(selected.name)} size={34} />
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        color: "var(--text-primary)",
                        fontWeight: 600,
                        fontSize: 15,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {selected.name}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginTop: 1,
                        flexWrap: "wrap",
                      }}
                    >
                      <Badge>
                        {selected.kind === "client" ? memberLabel : "Lead"}
                      </Badge>
                      {detail?.aiCategory &&
                        CATEGORY_META[detail.aiCategory] && (
                          <Badge colour={CATEGORY_META[detail.aiCategory].color}>
                            {CATEGORY_META[detail.aiCategory].label}
                          </Badge>
                        )}
                      <PriorityDot priority={detail?.aiPriority ?? null} />
                      {detail?.phone && (
                        <span
                          style={{
                            fontFamily: "var(--font-mono), monospace",
                            fontSize: 11,
                            color: "var(--text-tertiary)",
                          }}
                        >
                          {detail.phone}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <Link
                  href={selected.href}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    whiteSpace: "nowrap",
                  }}
                >
                  Open profile <ArrowUpRight size={13} />
                </Link>
              </div>

              {/* Thread body */}
              <div style={{ padding: "20px 24px", flex: 1 }}>
                {loadingThread || !detail ? (
                  <div
                    style={{
                      color: "var(--text-tertiary)",
                      fontSize: 13,
                      textAlign: "center",
                      padding: "28px 0",
                    }}
                  >
                    Loading…
                  </div>
                ) : (
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 16 }}
                  >
                    {detail.aiSummary && (
                      <div
                        style={{
                          fontSize: 12.5,
                          color: "var(--text-secondary)",
                          fontStyle: "italic",
                        }}
                      >
                        AI summary: {detail.aiSummary}
                      </div>
                    )}

                    {detail.sensitive && (
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "flex-start",
                          padding: 12,
                          border: "1px solid #f85149",
                          borderRadius: "var(--radius)",
                          background: "rgba(248,81,73,0.08)",
                        }}
                      >
                        <AlertTriangle size={16} color="#f85149" />
                        <div
                          style={{ fontSize: 13, color: "var(--text-primary)" }}
                        >
                          Flagged sensitive — held for you. The AI will never
                          auto-reply to this; please handle it personally.
                        </div>
                      </div>
                    )}

                    {detail.untriaged && (
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: 12,
                          border: "1px solid var(--hairline)",
                          borderRadius: "var(--radius)",
                          background: "var(--surface-2)",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 13,
                            color: "var(--text-secondary)",
                          }}
                        >
                          This message wasn&rsquo;t triaged by the AI.
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={retriaging}
                          onClick={retriage}
                        >
                          <RefreshCw size={14} />
                          {retriaging ? "Running…" : "Re-run AI"}
                        </Button>
                      </div>
                    )}

                    {showDraft && detail.draft && (
                      <div
                        style={{
                          padding: 14,
                          border: "1px solid var(--accent)",
                          borderRadius: "var(--radius)",
                          background: "var(--accent-soft)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            marginBottom: 8,
                          }}
                        >
                          <Sparkles size={14} color="var(--accent)" />
                          <span
                            style={{
                              fontSize: 11,
                              letterSpacing: "0.06em",
                              textTransform: "uppercase",
                              color: "var(--accent)",
                              fontFamily: "var(--font-mono), monospace",
                            }}
                          >
                            AI suggested reply
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: 14,
                            lineHeight: 1.6,
                            color: "var(--text-primary)",
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {detail.draft.text}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            marginTop: 12,
                          }}
                        >
                          <Button
                            size="sm"
                            disabled={!detail.hasPhone || sending}
                            onClick={() => handleSend(detail.draft!.text, true)}
                          >
                            <Check size={14} /> Approve &amp; send
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSeedText(detail.draft!.text);
                              setDraftDismissed(true);
                            }}
                          >
                            <Pencil size={14} /> Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDraftDismissed(true)}
                          >
                            <X size={14} /> Discard
                          </Button>
                        </div>
                      </div>
                    )}

                    <ConversationThread
                      messages={detail.messages}
                      canSend={detail.hasPhone}
                      sending={sending}
                      onSend={handleSend}
                      seedText={seedText}
                      emptyHint={
                        detail.hasPhone
                          ? "No messages yet. Send a WhatsApp to start the conversation."
                          : "No messages yet. No phone number on file for this contact."
                      }
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: "7px 10px",
        fontSize: 12,
        borderRadius: "var(--radius)",
        border: `1px solid ${value ? "var(--accent)" : "var(--hairline)"}`,
        background: "var(--surface-1)",
        color: value ? "var(--text-primary)" : "var(--text-secondary)",
        cursor: "pointer",
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
