"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { ChevronRight, GripVertical, Plus, Search, X } from "lucide-react";

import { saveWidgetsAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardLabel } from "@/components/ui/Card";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { SIZE_ORDER, type WidgetMeta, type WidgetRef, type WidgetSize } from "@/lib/dashboard/types";

export type GridItem = { ref: WidgetRef; title: string; href?: string; node: React.ReactNode };
export type CatalogEntry = Pick<WidgetMeta, "key" | "title" | "description" | "domain" | "sizes" | "defaultSize"> & {
  domainLabel: string;
};

type Draft = GridItem & { uid: string };

const SPAN: Record<WidgetSize, number> = { S: 1, M: 2, L: 3, XL: 4 };
let uidSeq = 0;
const nextUid = () => `w${++uidSeq}`;

export function DashboardGrid({ tabIndex, items, catalog }: { tabIndex: number; items: GridItem[]; catalog: CatalogEntry[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft[]>(() => items.map((it) => ({ ...it, uid: nextUid() })));
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = useMemo(
    () => JSON.stringify(draft.map((d) => d.ref)) !== JSON.stringify(items.map((i) => i.ref)),
    [draft, items],
  );

  // Enter edit mode from the TabBar's Customise button.
  useEffect(() => {
    const on = () => setEditing(true);
    window.addEventListener("dashboard:customise", on);
    return () => window.removeEventListener("dashboard:customise", on);
  }, []);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("dashboard:editing", { detail: editing }));
  }, [editing]);
  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!editing || !dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editing, dirty]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    setDraft((d) => {
      const from = d.findIndex((x) => x.uid === e.active.id);
      const to = d.findIndex((x) => x.uid === e.over!.id);
      return arrayMove(d, from, to);
    });
  }

  function cancel() {
    setDraft(items.map((it) => ({ ...it, uid: nextUid() })));
    setEditing(false);
    setError(null);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveWidgetsAction(tabIndex, draft.map((d) => d.ref));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function add(entry: CatalogEntry) {
    setDraft((d) => [
      ...d,
      {
        uid: nextUid(),
        ref: { key: entry.key, size: entry.defaultSize },
        title: entry.title,
        node: (
          <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>
            {entry.description} It will load when you save.
          </div>
        ),
      },
    ]);
    setAdding(false);
  }

  const sizesFor = (key: string) => catalog.find((c) => c.key === key)?.sizes ?? [];

  return (
    <>
      {editing && (
        <div
          style={{
            position: "sticky",
            top: 8,
            zIndex: 20,
            display: "flex",
            alignItems: "center",
            gap: 10,
            justifyContent: "space-between",
            padding: "10px 14px",
            marginBottom: 16,
            borderRadius: "var(--radius)",
            border: "1px solid var(--hairline)",
            background: "var(--surface-1)",
          }}
        >
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Drag tiles to reorder. Change a tile&rsquo;s size or remove it from its header.
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
              <Plus size={14} /> Add widget
            </Button>
            <Button variant="ghost" size="sm" onClick={cancel} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} loading={pending}>
              Done
            </Button>
          </div>
        </div>
      )}
      {error && <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {draft.length === 0 && (
        <Card style={{ textAlign: "center", padding: 32, marginBottom: 32 }}>
          <div style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 12 }}>This tab is empty.</div>
          <Button
            size="sm"
            onClick={() => {
              setEditing(true);
              setAdding(true);
            }}
          >
            <Plus size={14} /> Add widget
          </Button>
        </Card>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={draft.map((d) => d.uid)} strategy={rectSortingStrategy}>
          <div className="dash-grid">
            {draft.map((d) => (
              <Tile
                key={d.uid}
                item={d}
                editing={editing}
                sizes={sizesFor(d.ref.key)}
                onSize={(size) => setDraft((all) => all.map((x) => (x.uid === d.uid ? { ...x, ref: { ...x.ref, size } } : x)))}
                onRemove={() => setDraft((all) => all.filter((x) => x.uid !== d.uid))}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <AddWidgetSheet open={adding} onOpenChange={setAdding} catalog={catalog} onAdd={add} />
    </>
  );
}

function Tile({
  item,
  editing,
  sizes,
  onSize,
  onRemove,
}: {
  item: Draft;
  editing: boolean;
  sizes: readonly WidgetSize[];
  onSize: (s: WidgetSize) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.uid,
    disabled: !editing,
  });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    zIndex: isDragging ? 30 : undefined,
    opacity: isDragging ? 0.85 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className={`dash-tile dash-span-${SPAN[item.ref.size]}`}>
      <Card className={editing && !isDragging ? "dash-wobble" : undefined} style={{ height: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          {editing && (
            <button
              type="button"
              aria-label={`Move ${item.title}`}
              {...attributes}
              {...listeners}
              style={{ cursor: "grab", color: "var(--text-tertiary)", background: "none", border: 0, padding: 0, display: "flex" }}
            >
              <GripVertical size={15} />
            </button>
          )}
          <CardLabel style={{ marginBottom: 0, flex: 1, minWidth: 0 }}>{item.title}</CardLabel>
          {editing ? (
            <>
              <div role="group" aria-label="Tile size" style={{ display: "flex", gap: 2 }}>
                {SIZE_ORDER.filter((s) => sizes.includes(s)).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onSize(s)}
                    aria-pressed={item.ref.size === s}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "2px 6px",
                      borderRadius: 6,
                      border: "1px solid var(--hairline)",
                      background: item.ref.size === s ? "var(--accent)" : "transparent",
                      color: item.ref.size === s ? "var(--bg)" : "var(--text-secondary)",
                      cursor: "pointer",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <button
                type="button"
                aria-label={`Remove ${item.title}`}
                onClick={onRemove}
                style={{ color: "var(--text-tertiary)", background: "none", border: 0, cursor: "pointer", display: "flex" }}
              >
                <X size={15} />
              </button>
            </>
          ) : (
            item.href && (
              <Link href={item.href} aria-label={`Open ${item.title}`} style={{ color: "var(--text-tertiary)", display: "flex" }}>
                <ChevronRight size={16} />
              </Link>
            )
          )}
        </div>
        <div style={editing ? { pointerEvents: "none" } : undefined}>{item.node}</div>
      </Card>
    </div>
  );
}

function AddWidgetSheet({
  open,
  onOpenChange,
  catalog,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  catalog: CatalogEntry[];
  onAdd: (e: CatalogEntry) => void;
}) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hits = catalog.filter(
      (c) => !needle || c.title.toLowerCase().includes(needle) || c.description.toLowerCase().includes(needle),
    );
    const by = new Map<string, CatalogEntry[]>();
    for (const c of hits) by.set(c.domainLabel, [...(by.get(c.domainLabel) ?? []), c]);
    return [...by.entries()];
  }, [catalog, q]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="Add a widget" width={460}>
        <div style={{ position: "relative", marginBottom: 16 }}>
          <Search size={14} style={{ position: "absolute", left: 12, top: 12, color: "var(--text-tertiary)" }} />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search widgets"
            aria-label="Search widgets"
            style={{ paddingLeft: 32 }}
          />
        </div>
        {groups.length === 0 && <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>No widgets match.</div>}
        {groups.map(([label, list]) => (
          <div key={label} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 8 }}>
              {label}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {list.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => onAdd(c)}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: "var(--radius)",
                    border: "1px solid var(--hairline)",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 500 }}>{c.title}</div>
                  <div style={{ color: "var(--text-tertiary)", fontSize: 12.5, marginTop: 2 }}>{c.description}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </SheetContent>
    </Sheet>
  );
}
