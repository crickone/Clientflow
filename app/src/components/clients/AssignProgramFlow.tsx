"use client";

import { useState } from "react";
import { toast } from "sonner";

import { checkDraftAction, coachAssignAction } from "@/app/clients/[id]/program/actions";
import { StartProgramForm } from "@/components/clientapp/StartProgramForm";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { ProgramCopyEditor } from "@/components/workout/ProgramCopyEditor";
import type { PlanExtra } from "@/lib/programs/outline";
import type { StartLift } from "@/lib/programs/startFlow";
import type { StartProgramInput } from "@/lib/programs/startInput";
import type { ProgramTemplate, WeightUnit } from "@/lib/programs/types";
import type { StepKey } from "@/lib/programs/units";

/**
 * Staff set a program for a member: optionally edit it for them first, then
 * the same setup the member would fill in, with the first-week preview.
 */
export function AssignProgramFlow({
  clientId,
  memberName,
  programKey,
  template,
  lifts,
  extra,
  initialUnit,
  initialStep,
  defaultWeekdays,
  today,
  liveName,
  engineLabel,
  isBlock,
  fullBlock,
}: {
  clientId: number;
  memberName: string;
  programKey: string;
  template: ProgramTemplate;
  lifts: StartLift[];
  extra: PlanExtra;
  initialUnit: WeightUnit;
  initialStep: StepKey;
  defaultWeekdays: number[];
  today: string;
  liveName: string | null;
  engineLabel: string;
  isBlock: boolean;
  fullBlock: boolean;
}) {
  const confirm = useConfirm();
  // null means the program as it is in the library.
  const [draft, setDraft] = useState<ProgramTemplate | null>(null);
  const [editing, setEditing] = useState(false);
  const shown = draft ?? template;

  async function submit(input: StartProgramInput): Promise<{ ok: true } | { ok: false; error: string }> {
    let r = await coachAssignAction(clientId, input, draft, false);
    if (!r.ok && "needsReplace" in r && r.needsReplace) {
      const ok = await confirm({
        title: `Replace ${liveName ?? "their program"}?`,
        body: `Setting this program ends ${liveName ?? "their current program"} for ${memberName}. Its history is kept.`,
        confirmLabel: "End it and set this one",
        destructive: true,
      });
      if (!ok) return { ok: false, error: "Nothing was changed." };
      r = await coachAssignAction(clientId, input, draft, true);
    }
    if (!r.ok) return { ok: false, error: r.error };
    toast.success(`Program set. ${memberName} sees it in their app.`);
    return { ok: true };
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <p style={{ margin: 0 }}>
        Set {template.name} for {memberName}. Edits here change only {memberName}&apos;s copy.
        {draft ? " This copy has your changes." : ""}
      </p>
      {!editing && (
        <div>
          <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
            Edit for {memberName} first
          </Button>
        </div>
      )}
      {editing ? (
        <ProgramCopyEditor
          initial={shown}
          lifts={template.lifts}
          engineLabel={engineLabel}
          isBlock={isBlock}
          fullBlock={fullBlock}
          saveLabel="Use these changes"
          savedMessage="Changes kept. Finish the setup to save them."
          save={async (t) => {
            const r = await checkDraftAction(clientId, programKey, t);
            if (r.ok) {
              setDraft(t);
              setEditing(false);
            }
            return r;
          }}
        />
      ) : (
        <div style={{ maxWidth: 480, width: "100%", margin: "0 auto" }}>
          <StartProgramForm
            programKey={programKey}
            programName={shown.name}
            template={shown}
            extra={extra}
            lifts={lifts}
            initialUnit={initialUnit}
            initialStep={initialStep}
            defaultWeekdays={defaultWeekdays}
            today={today}
            backHref={`/clients/${clientId}/program/assign`}
            doneHref={`/clients/${clientId}`}
            submitLabel="Set this program"
            submit={submit}
          />
        </div>
      )}
    </div>
  );
}
