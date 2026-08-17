"use client";

import type { CSSProperties } from "react";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/Dialog";
import { Input, Label } from "@/components/ui/Input";
import {
  addStageAction,
  deleteStageAction,
  reorderStagesAction,
  updateStageAction,
} from "@/app/settings/pipeline/actions";
import {
  ALL_ROLES,
  DEFAULT_STAGES,
  ROLE_HINTS,
  canDeleteStage,
  roleConflict,
  type StageRecord,
  type StageRole,
} from "@/lib/pipeline/roles";

/** Small fixed palette: the 9 default-stage colours, plus a few extras for custom stages. */
const PALETTE: string[] = Array.from(
  new Set([...DEFAULT_STAGES.map((s) => s.colour), "#e93b81", "#eab308", "#14b8a6", "#64748b"]),
);

const selectStyle: CSSProperties = {
  background: "var(--bg)",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
  padding: "9px 12px",
  color: "var(--text-primary)",
  fontSize: 13,
  outline: "none",
  fontFamily: "inherit",
};

export function PipelineStagesManager({ stages: initialStages }: { stages: StageRecord[] }) {
  const router = useRouter();
  const [stages, setStages] = useState<StageRecord[]>(initialStages);

  // Re-sync from the server after every router.refresh() (post-mutation revalidate)
  // so field edits / add / delete actually land in the rendered list — a plain
  // useState(initialStages) only seeds ONCE at mount and would otherwise leave
  // colour/role selects showing stale values after a successful save. Same
  // purpose as PipelineBoard.tsx's propLeads-sync effect, simplified: no
  // concurrent-poll / mid-drag guard needed since this screen has no polling
  // and a drag gesture resolves (or reverts) synchronously before any refresh.
  useEffect(() => {
    setStages(initialStages);
  }, [initialStages]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = stages.findIndex((s) => s.id === active.id);
    const newIndex = stages.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const previous = stages;
    const next = arrayMove(stages, oldIndex, newIndex);
    setStages(next); // optimistic — instant reorder feedback

    reorderStagesAction(next.map((s) => s.id)).then((res) => {
      if (!res.ok) {
        toast.error(res.error);
        setStages(previous);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {stages.map((stage) => (
            <StageRow key={stage.id} stage={stage} stages={stages} />
          ))}
        </SortableContext>
      </DndContext>
      <AddStageRow existing={stages} />
    </div>
  );
}

function StageRow({ stage, stages }: { stage: StageRecord; stages: StageRecord[] }) {
  const router = useRouter();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stage.id,
  });
  const [name, setName] = useState(stage.name);
  const [savingField, startSave] = useTransition();
  const [colourOpen, setColourOpen] = useState(false);

  function saveName() {
    const trimmed = name.trim();
    if (!trimmed) {
      setName(stage.name); // no blanking the name — revert
      return;
    }
    if (trimmed === stage.name) return;
    startSave(async () => {
      const res = await updateStageAction(stage.id, { name: trimmed });
      if (!res.ok) {
        toast.error(res.error);
        setName(stage.name);
        return;
      }
      router.refresh();
    });
  }

  function pickColour(colour: string) {
    setColourOpen(false);
    if (colour === stage.colour) return;
    startSave(async () => {
      const res = await updateStageAction(stage.id, { colour });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  function pickRole(role: StageRole | null) {
    startSave(async () => {
      const res = await updateStageAction(stage.id, { role });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(role ? `Tagged "${stage.name}" as ${role}` : `Cleared the role on "${stage.name}"`);
      router.refresh();
    });
  }

  const style: CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition: transition ?? undefined,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Card
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          padding: 14,
          opacity: savingField ? 0.6 : 1,
          transition: "opacity 0.15s var(--ease)",
        }}
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${stage.name}`}
          style={{
            cursor: "grab",
            touchAction: "none",
            background: "transparent",
            border: "none",
            color: "var(--text-tertiary)",
            padding: 4,
            display: "inline-flex",
            flexShrink: 0,
          }}
        >
          <GripVertical size={16} strokeWidth={1.75} />
        </button>

        <ColourSwatchButton
          colour={stage.colour}
          open={colourOpen}
          onOpenChange={setColourOpen}
          onPick={pickColour}
          disabled={savingField}
        />

        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          disabled={savingField}
          aria-label="Stage name"
          style={{ flex: "1 1 140px", minWidth: 120 }}
        />

        <select
          value={stage.role ?? ""}
          onChange={(e) => pickRole((e.target.value || null) as StageRole | null)}
          disabled={savingField}
          aria-label="Stage role"
          style={{ ...selectStyle, flex: "1 1 220px", minWidth: 200 }}
        >
          <option value="">— none —</option>
          {ALL_ROLES.map((role) => {
            const holder = roleConflict(stages, role, stage.id);
            return (
              <option key={role} value={role} disabled={!!holder}>
                {ROLE_HINTS[role]}
                {holder ? ` (used by "${holder.name}")` : ""}
              </option>
            );
          })}
        </select>

        <DeleteStageButton stage={stage} stages={stages} />
      </Card>
    </div>
  );
}

function ColourSwatchButton({
  colour,
  open,
  onOpenChange,
  onPick,
  disabled,
}: {
  colour: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (colour: string) => void;
  disabled?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="Change stage colour"
          disabled={disabled}
          style={{
            width: 26,
            height: 26,
            borderRadius: "var(--radius-sm)",
            background: colour,
            border: "1px solid var(--hairline-strong)",
            flexShrink: 0,
            cursor: disabled ? "default" : "pointer",
            padding: 0,
            opacity: disabled ? 0.6 : 1,
          }}
        />
      </DialogTrigger>
      <DialogContent title="Stage colour" width={300}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onPick(c)}
              aria-label={`Choose ${c}`}
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                background: c,
                border: c === colour ? "2px solid var(--text-primary)" : "1px solid var(--hairline-strong)",
                cursor: "pointer",
                padding: 0,
              }}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteStageButton({ stage, stages }: { stage: StageRecord; stages: StageRecord[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [moveToId, setMoveToId] = useState<number | "">("");

  const others = stages.filter((s) => s.id !== stage.id);
  const gate = canDeleteStage(stages, stage.id);

  function confirmDelete() {
    if (!gate.ok || moveToId === "") return;
    start(async () => {
      const res = await deleteStageAction(stage.id, moveToId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`"${stage.name}" deleted`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setMoveToId("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Delete ${stage.name}`} style={{ marginLeft: "auto" }}>
          <Trash2 size={14} strokeWidth={1.75} />
        </Button>
      </DialogTrigger>
      <DialogContent title="Delete stage" description={stage.name} width={420}>
        {!gate.ok ? (
          <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.5 }}>{gate.reason}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.5 }}>
              Any leads currently on <strong>{stage.name}</strong> move to the stage you pick below. This
              can&apos;t be undone.
            </p>
            <div>
              <Label htmlFor="move-to-stage">Move its leads to</Label>
              <select
                id="move-to-stage"
                value={moveToId}
                onChange={(e) => setMoveToId(Number(e.target.value))}
                style={{ ...selectStyle, width: "100%" }}
              >
                <option value="" disabled>
                  Choose a stage…
                </option>
                {others.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <DialogClose asChild>
            <Button variant="ghost" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          {gate.ok && (
            <Button variant="destructive" onClick={confirmDelete} disabled={pending || moveToId === ""}>
              {pending ? "Deleting…" : "Delete"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddStageRow({ existing }: { existing: StageRecord[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [colour, setColour] = useState(PALETTE[0]);
  const [role, setRole] = useState<StageRole | "">("");
  const [colourOpen, setColourOpen] = useState(false);
  const [pending, start] = useTransition();

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Name is required");
      return;
    }
    start(async () => {
      const res = await addStageAction({ name: trimmed, colour, role: (role || null) as StageRole | null });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`"${trimmed}" added`);
      setName("");
      setColour(PALETTE[0]);
      setRole("");
      router.refresh();
    });
  }

  return (
    <Card
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        padding: 14,
        borderStyle: "dashed",
      }}
    >
      <div aria-hidden style={{ width: 24, flexShrink: 0 }} />

      <ColourSwatchButton
        colour={colour}
        open={colourOpen}
        onOpenChange={setColourOpen}
        onPick={(c) => {
          setColour(c);
          setColourOpen(false);
        }}
        disabled={pending}
      />

      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="New stage name"
        disabled={pending}
        aria-label="New stage name"
        style={{ flex: "1 1 140px", minWidth: 120 }}
      />

      <select
        value={role}
        onChange={(e) => setRole((e.target.value || "") as StageRole | "")}
        disabled={pending}
        aria-label="New stage role"
        style={{ ...selectStyle, flex: "1 1 220px", minWidth: 200 }}
      >
        <option value="">— none —</option>
        {ALL_ROLES.map((r) => {
          const holder = roleConflict(existing, r, null);
          return (
            <option key={r} value={r} disabled={!!holder}>
              {ROLE_HINTS[r]}
              {holder ? ` (used by "${holder.name}")` : ""}
            </option>
          );
        })}
      </select>

      <Button
        variant="secondary"
        size="sm"
        onClick={submit}
        disabled={pending || !name.trim()}
        style={{ marginLeft: "auto" }}
      >
        <Plus size={14} strokeWidth={2} />
        {pending ? "Adding…" : "Add stage"}
      </Button>
    </Card>
  );
}
