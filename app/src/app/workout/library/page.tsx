// app/src/app/workout/library/page.tsx
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/PageHeader";
import { ProgramLibraryView, type LibraryRow } from "@/components/workout/ProgramLibraryView";
import { hiddenKeys } from "@/lib/programs/library";
import { PLATFORM_PROGRAMS } from "@/lib/programs/registry";
import { currentStaffActor } from "@/lib/programs/staffActor";
import { ENGINE_LABEL, FAMILY_LABEL } from "@/lib/programs/types";

export const dynamic = "force-dynamic";

export default async function ProgramLibraryPage() {
  // Signs the user in and is null where Programs is off for this business.
  if (!(await currentStaffActor())) notFound();
  const hidden = hiddenKeys();
  const rows: LibraryRow[] = PLATFORM_PROGRAMS.map((t) => ({
    key: t.key,
    name: t.name,
    author: t.author,
    family: FAMILY_LABEL[t.family],
    days: t.daysPerWeek,
    weeks: t.lengthWeeks,
    engine: ENGINE_LABEL[t.engine.key],
    warning: t.warning ?? null,
    hidden: hidden.has(t.key),
  }));
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Workout"
        title="Program library"
        subtitle="Well-known programs your DIY members can run on their own, with every weight worked out from their maxes. Hide any you don't want offered."
      />
      <ProgramLibraryView rows={rows} />
    </div>
  );
}
