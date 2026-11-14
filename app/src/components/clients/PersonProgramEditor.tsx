"use client";

import { coachEditProgramAction } from "@/app/clients/[id]/program/actions";
import { ProgramCopyEditor } from "@/components/workout/ProgramCopyEditor";
import type { LiftKey, ProgramTemplate } from "@/lib/programs/types";

/** A coach's editor for one member's running program. */
export function PersonProgramEditor(props: { clientId: number; enrolmentId: number; initial: ProgramTemplate; lifts: LiftKey[]; engineLabel: string; isBlock: boolean; fullBlock: boolean }) {
  const { clientId, enrolmentId, ...rest } = props;
  return (
    <ProgramCopyEditor
      {...rest}
      save={(t, origins) => coachEditProgramAction(clientId, enrolmentId, t, origins)}
      saveLabel="Save changes"
      savedMessage="Saved. The member gets these changes from their next session."
    />
  );
}
