"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LayoutGroup, motion } from "motion/react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Search } from "lucide-react";
import { toast } from "sonner";

import type { LeadWithSla } from "@/lib/leads";
import { setLeadStageAction } from "@/app/leads/actions";
import { WON_ROLES, type StageRecord } from "@/lib/pipeline/roles";
import { Input } from "@/components/ui/Input";
import { LeadList } from "@/components/leads/LeadList";
import { LeadCard } from "./LeadCard";
import { StageColumn } from "./StageColumn";

const WON_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function PipelineBoard({ leads: propLeads, stages }: { leads: LeadWithSla[]; stages: StageRecord[] }) {
  const router = useRouter();
  const [leads, setLeads] = useState<LeadWithSla[]>(propLeads);
  const [view, setView] = useState<"board" | "list">("board");
  const [q, setQ] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [railOpen, setRailOpen] = useState<Record<string, boolean>>({});
  const [activeId, setActiveId] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const draggingRef = useRef(false);
  const pendingIds = useRef<Set<number>>(new Set());

  // Server is the source of truth; adopt refreshed props — but never mid-drag,
  // and preserve the optimistic stage of any move still awaiting the server, so
  // a periodic/focus refresh landing in that window can't snap the card back.
  useEffect(() => {
    if (draggingRef.current) return;
    setLeads((prev) => {
      if (pendingIds.current.size === 0) return propLeads;
      const optimistic = new Map<number, LeadWithSla["stage"]>();
      for (const l of prev) {
        if (pendingIds.current.has(l.id)) optimistic.set(l.id, l.stage);
      }
      return propLeads.map((l) =>
        optimistic.has(l.id) ? { ...l, stage: optimistic.get(l.id)! } : l,
      );
    });
  }, [propLeads]);

  // Restore the saved view once on mount (avoids SSR mismatch).
  useEffect(() => {
    const saved = localStorage.getItem("leads.view");
    if (saved === "board" || saved === "list") setView(saved);
  }, []);
  useEffect(() => {
    localStorage.setItem("leads.view", view);
  }, [view]);

  // Live-ish clock + auto-move visibility: re-tick `now` and pull fresh server
  // data every 30s and whenever the tab regains focus.
  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
      router.refresh();
    };
    const iv = setInterval(tick, 30_000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(iv);
      window.removeEventListener("focus", tick);
    };
  }, [router]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return leads;
    return leads.filter((l) =>
      [l.firstName, l.lastName, l.email, l.phone, l.therapyInterest, l.campaign, l.notes, l.source]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [leads, q]);

  // Funnel = ordinary stages (position order, as returned by listStages()); rails = lapsed/lost.
  const funnelStages = useMemo(
    () => stages.filter((s) => s.role !== "lapsed" && s.role !== "lost"),
    [stages],
  );
  const railStages = useMemo(
    () => stages.filter((s) => s.role === "lapsed" || s.role === "lost"),
    [stages],
  );

  // Bucket by stage id; apply the 30-day window to won/repeat stages (keep all-time totals).
  const byStage = useMemo(() => {
    const visible = new Map<number, LeadWithSla[]>();
    const totals = new Map<number, number>();
    for (const s of stages) {
      visible.set(s.id, []);
      totals.set(s.id, 0);
    }
    for (const l of filtered) {
      const sid = l.stage?.id;
      if (sid == null) continue;
      totals.set(sid, (totals.get(sid) ?? 0) + 1);
      const role = l.stage?.role ?? null;
      if (role != null && WON_ROLES.has(role) && now - l.updatedAt.getTime() > WON_WINDOW_MS) continue;
      visible.get(sid)?.push(l);
    }
    return { visible, totals };
  }, [filtered, now, stages]);

  const openLead = useCallback((id: number) => router.push(`/leads/${id}`), [router]);
  const draftLead = useCallback((id: number) => router.push(`/leads/${id}?draft=1`), [router]);
  const whatsappLead = useCallback((id: number) => router.push(`/leads/${id}?reply=whatsapp`), [router]);

  const move = useCallback(
    (id: number, to: StageRecord, from: StageRecord) => {
      pendingIds.current.add(id);
      setLeads((prev) =>
        prev.map((l) => (l.id === id ? { ...l, stage: to, updatedAt: new Date() } : l)),
      );
      startTransition(async () => {
        try {
          await setLeadStageAction(id, to.id);
          toast.success(`Moved to ${to.name}`, {
            duration: 5000,
            action: { label: "Undo", onClick: () => move(id, from, to) },
          });
        } catch {
          // Only revert if a newer move hasn't since superseded this one.
          setLeads((prev) =>
            prev.map((l) =>
              l.id === id && l.stage?.id === to.id ? { ...l, stage: from } : l,
            ),
          );
          toast.error("Couldn't move the lead. Reverted.");
        } finally {
          pendingIds.current.delete(id);
        }
      });
    },
    [],
  );

  function onDragStart(e: DragStartEvent) {
    draggingRef.current = true;
    setActiveId(Number(e.active.id));
  }
  function onDragEnd(e: DragEndEvent) {
    draggingRef.current = false;
    setActiveId(null);
    const overId = e.over?.id as string | undefined;
    if (!overId) return;
    const target = stages.find((s) => s.id === Number(overId));
    if (!target) return;
    const id = Number(e.active.id);
    const lead = leads.find((l) => l.id === id);
    if (!lead || !lead.stage || lead.stage.id === target.id) return;
    move(id, target, lead.stage);
  }

  const activeLead = activeId != null ? leads.find((l) => l.id === activeId) ?? null : null;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 360 }}>
          <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)", pointerEvents: "none" }} />
          <Input placeholder="Search leads…" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 34 }} />
        </div>
        <div role="tablist" style={{ marginLeft: "auto", display: "inline-flex", background: "var(--surface-1)", border: "1px solid var(--hairline)", borderRadius: "var(--radius)", padding: 3, gap: 2 }}>
          {(["board", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              style={{
                padding: "6px 14px",
                borderRadius: "var(--radius)",
                fontSize: 13,
                fontWeight: 500,
                textTransform: "capitalize",
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                color: view === v ? "var(--text-primary)" : "var(--text-secondary)",
                background: view === v ? "var(--bg)" : "transparent",
                boxShadow: view === v ? "0 1px 3px -1px rgba(0,0,0,0.1)" : "none",
              }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === "list" ? (
        <LeadList leads={filtered} stages={stages} />
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <LayoutGroup>
            <div style={{ display: "flex", gap: 12, overflowX: "auto", scrollSnapType: "x proximity", paddingBottom: 12, alignItems: "stretch" }}>
              {funnelStages.map((stage) => {
                const cards = byStage.visible.get(stage.id) ?? [];
                return (
                  <StageColumn key={stage.id} stageId={stage.id} stage={stage} count={cards.length} total={byStage.totals.get(stage.id)}>
                    {cards.map((lead) => (
                      <DraggableCard key={lead.id} lead={lead} now={now} onOpen={openLead} onDraft={draftLead} onWhatsApp={whatsappLead} />
                    ))}
                  </StageColumn>
                );
              })}
              {railStages.map((stage) => {
                const cards = byStage.visible.get(stage.id) ?? [];
                return (
                  <StageColumn
                    key={stage.id}
                    stageId={stage.id}
                    stage={stage}
                    count={cards.length}
                    total={byStage.totals.get(stage.id)}
                    rail
                    expanded={!!railOpen[stage.id]}
                    onToggle={() => setRailOpen((r) => ({ ...r, [stage.id]: !r[stage.id] }))}
                  >
                    {cards.map((lead) => (
                      <DraggableCard key={lead.id} lead={lead} now={now} onOpen={openLead} onDraft={draftLead} onWhatsApp={whatsappLead} />
                    ))}
                  </StageColumn>
                );
              })}
            </div>
          </LayoutGroup>
          <DragOverlay>
            {activeLead ? (
              <div style={{ width: 280 }}>
                <LeadCard lead={activeLead} now={now} onDraft={() => {}} onWhatsApp={() => {}} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </>
  );
}

/** Wraps a LeadCard: outer motion.div owns the auto-move glide; inner node owns the drag transform. */
function DraggableCard({
  lead,
  now,
  onOpen,
  onDraft,
  onWhatsApp,
}: {
  lead: LeadWithSla;
  now: number;
  onOpen: (id: number) => void;
  onDraft: (id: number) => void;
  onWhatsApp: (id: number) => void;
}) {
  const { setNodeRef, listeners, attributes, transform, isDragging } = useDraggable({ id: lead.id });
  return (
    <motion.div layout layoutId={String(lead.id)} transition={{ duration: 0.25 }} style={{ opacity: isDragging ? 0.35 : 1 }}>
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        onClick={() => onOpen(lead.id)}
        style={{
          cursor: "grab",
          touchAction: "none",
          transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        }}
      >
        <LeadCard lead={lead} now={now} onDraft={onDraft} onWhatsApp={onWhatsApp} />
      </div>
    </motion.div>
  );
}
