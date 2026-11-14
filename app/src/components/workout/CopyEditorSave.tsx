"use client";

import { saveCopyAction } from "@/app/workout/library/actions";
import { ProgramCopyEditor } from "@/components/workout/ProgramCopyEditor";
import type { LiftKey, ProgramTemplate } from "@/lib/programs/types";

/** The gym-version page's editor: saves to the gym's own library. */
export function CopyEditorSave(props: { id: number; initial: ProgramTemplate; lifts: LiftKey[]; engineLabel: string; isBlock: boolean; fullBlock: boolean }) {
  const { id, ...rest } = props;
  return <ProgramCopyEditor {...rest} save={(t) => saveCopyAction(id, t)} saveLabel="Save our version" savedMessage="Saved. Members who start this version from now on get these changes." />;
}
