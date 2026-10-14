"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { createPipelineAction, deletePipelineAction, renamePipelineAction } from "@/app/settings/pipeline/actions";
import type { PipelineRecord } from "@/lib/pipeline/pipelineRepo";

/** "+ New pipeline" at the end of the pipeline tabs: a separate board with its own columns. */
export function NewPipelineButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  function create() {
    start(async () => {
      const r = await createPipelineAction(name);
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${name.trim()} created`);
      setOpen(false);
      setName("");
      router.push(`/leads?pipeline=${r.id}`);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" className="pl-newtab" onClick={() => setOpen(true)}>
        <Plus size={14} /> New pipeline
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="New pipeline" description="A separate board for a different kind of lead, e.g. corporate enquiries. It starts with the same columns as your main pipeline; change them under Manage stages." width={460}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create();
            }}
            style={{ display: "grid", gap: 14 }}
          >
            <Input autoFocus placeholder="Pipeline name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Pipeline name" />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={pending} disabled={!name.trim()}>
                Create pipeline
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Rename or delete the pipeline being managed (top of the Manage stages dialog). */
export function PipelineSettings({ pipeline, onDeleted }: { pipeline: PipelineRecord; onDeleted: () => void }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [name, setName] = useState(pipeline.name);
  const [pending, start] = useTransition();
  const changed = name.trim() !== pipeline.name && name.trim().length > 0;

  function rename() {
    start(async () => {
      const r = await renamePipelineAction(pipeline.id, name);
      if (!r.ok) return void toast.error(r.error);
      toast.success("Pipeline renamed");
      router.refresh();
    });
  }

  async function remove() {
    const ok = await confirm({
      title: `Delete ${pipeline.name}?`,
      body: "Its leads move to the matching column in your main pipeline, so none are lost. Its columns are removed.",
      confirmLabel: "Delete pipeline",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const r = await deletePipelineAction(pipeline.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.moved ? `Pipeline deleted. ${r.moved} ${r.moved === 1 ? "lead" : "leads"} moved to the main pipeline.` : "Pipeline deleted");
      onDeleted();
      router.push("/leads");
      router.refresh();
    });
  }

  return (
    <div className="pl-settings">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (changed) rename();
        }}
        className="pl-settings-name"
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Pipeline name" />
        <Button type="submit" variant="secondary" size="sm" disabled={!changed} loading={pending && changed}>
          Rename
        </Button>
      </form>
      {pipeline.isDefault ? (
        <span className="pl-settings-note">The main pipeline can&rsquo;t be deleted.</span>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => void remove()} disabled={pending}>
          <Trash2 size={14} /> Delete pipeline
        </Button>
      )}
    </div>
  );
}
