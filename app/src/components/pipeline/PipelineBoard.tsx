"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
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
import { Search, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import type { LeadWithSla } from "@/lib/leads";
import { setLeadStageAction } from "@/app/leads/actions";
import { WON_ROLES, type StageRecord } from "@/lib/pipeline/roles";
import { computeBoardMetrics, type LeadMetricInput } from "@/lib/pipeline/boardMetrics";
import { Input } from "@/components/ui/Input";
import { LeadList } from "@/components/leads/LeadList";
import { LeadCard } from "./LeadCard";
import { PipelineMetrics } from "./PipelineMetrics";
import { StageColumn } from "./StageColumn";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { PipelineStagesManager } from "@/components/settings/PipelineStagesManager";

const WON_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Distinct, non-null, sorted values — for populating a filter dropdown's options. */
function distinctValues(values: (string | null)[]): string[] {
  return [...new Set(values)].filter((v): v is string => Boolean(v)).sort();
}

const selectStyle: CSSProperties = {
  height: 38,
  padding: "0 12px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "var(--surface-1)",
  color: "var(--text-primary)",
  fontSize: 13,
  fontFamily: "inherit",
  cursor: "pointer",
  minWidth: 140,
};

export function PipelineBoard({ leads: propLeads, stages, canManageStages }: { leads: LeadWithSla[]; stages: StageRecord[]; canManageStages: boolean }) {
  const router = useRouter();
  const [leads, setLeads] = useState<LeadWithSla[]>(propLeads);
  const [view, setView] = useState<"board" | "list">("board");
  const [q, setQ] = useState("");
  const [campaignFilter, setCampaignFilter] = useState("");
  const [therapyFilter, setTherapyFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [railOpen, setRailOpen] = useState<Record<string, boolean>>({});
  const [activeId, setActiveId] = useState<number | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
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

  // Restore saved filter selections once on mount — same pattern as the view
  // toggle above, but only applied if still valid for these leads (a stale
  // campaign/therapy/source no longer present would otherwise empty the board).
  useEffect(() => {
    const savedCampaign = localStorage.getItem("leads.filter.campaign");
    const savedTherapy = localStorage.getItem("leads.filter.therapy");
    const savedSource = localStorage.getItem("leads.filter.source");
    if (savedCampaign && leads.some((l) => l.campaign === savedCampaign)) setCampaignFilter(savedCampaign);
    if (savedTherapy && leads.some((l) => l.therapyInterest === savedTherapy)) setTherapyFilter(savedTherapy);
    if (savedSource && leads.some((l) => l.source === savedSource)) setSourceFilter(savedSource);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    localStorage.setItem("leads.filter.campaign", campaignFilter);
    localStorage.setItem("leads.filter.therapy", therapyFilter);
    localStorage.setItem("leads.filter.source", sourceFilter);
  }, [campaignFilter, therapyFilter, sourceFilter]);

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

  // Distinct non-null values across ALL leads (not just `filtered`), so picking
  // one filter never shrinks the options offered by the other two dropdowns.
  const campaignOptions = useMemo(() => distinctValues(leads.map((l) => l.campaign)), [leads]);
  const therapyOptions = useMemo(() => distinctValues(leads.map((l) => l.therapyInterest)), [leads]);
  const sourceOptions = useMemo(() => distinctValues(leads.map((l) => l.source)), [leads]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return leads.filter((l) => {
      if (campaignFilter && l.campaign !== campaignFilter) return false;
      if (therapyFilter && l.therapyInterest !== therapyFilter) return false;
      if (sourceFilter && l.source !== sourceFilter) return false;
      if (!needle) return true;
      return [l.firstName, l.lastName, l.email, l.phone, l.therapyInterest, l.campaign, l.notes, l.source]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [leads, q, campaignFilter, therapyFilter, sourceFilter]);

  // Segment-scoped metrics: recomputes from `filtered`, so the 4 tiles above
  // the board always describe the currently-visible segment (search + filters).
  const metrics = useMemo(() => {
    const input: LeadMetricInput[] = filtered.map((l) => ({
      createdAt: l.createdAt.getTime(),
      updatedAt: l.updatedAt.getTime(),
      role: l.stage?.role ?? null,
      firstOutboundAt: l.firstOutboundAt,
    }));
    return computeBoardMetrics(input, now);
  }, [filtered, now]);

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
      <PipelineMetrics metrics={metrics} />

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 360 }}>
          <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)", pointerEvents: "none" }} />
          <Input placeholder="Search leads…" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 34 }} />
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            aria-label="Filter by campaign"
            value={campaignFilter}
            onChange={(e) => setCampaignFilter(e.target.value)}
            style={selectStyle}
          >
            <option value="">All campaigns</option>
            {campaignOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            aria-label="Filter by therapy interest"
            value={therapyFilter}
            onChange={(e) => setTherapyFilter(e.target.value)}
            style={selectStyle}
          >
            <option value="">All therapies</option>
            {therapyOptions.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select
            aria-label="Filter by source"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            style={selectStyle}
          >
            <option value="">All sources</option>
            {sourceOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {canManageStages && (
            <button
              type="button"
              onClick={() => setManageOpen(true)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 38, padding: "0 12px", borderRadius: "var(--radius)", border: "1px solid var(--hairline)", background: "var(--surface-1)", color: "var(--text-primary)", fontSize: 13, fontFamily: "inherit", cursor: "pointer" }}
            >
              <SlidersHorizontal size={14} /> Manage stages
            </button>
          )}
          <div role="tablist" style={{ display: "inline-flex", background: "var(--surface-1)", border: "1px solid var(--hairline)", borderRadius: "var(--radius)", padding: 3, gap: 2 }}>
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

      {canManageStages && (
        <Dialog open={manageOpen} onOpenChange={setManageOpen}>
          <DialogContent title="Pipeline stages" description="Add, rename, reorder or recolour your stages — changes apply to the board immediately." width={720}>
            <PipelineStagesManager stages={stages} />
          </DialogContent>
        </Dialog>
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
