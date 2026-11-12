import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { ProgramPreviewTable } from "@/components/workout/ProgramPreviewTable";
import { byline, cardLine, toCard } from "@/lib/programs/cards";
import { programByKey } from "@/lib/programs/library";
import { previewProgram } from "@/lib/programs/preview";
import { currentStaffActor } from "@/lib/programs/staffActor";
import { ENGINE_LABEL, LIFT_LABEL } from "@/lib/programs/types";

export const dynamic = "force-dynamic";

export default async function ProgramPreviewPage(props: { params: Promise<{ key: string }> }) {
  // Signs the user in and is null where Programs is off for this business.
  if (!(await currentStaffActor())) notFound();
  const { key } = await props.params;
  const entry = programByKey(decodeURIComponent(key), { includeHidden: true });
  if (!entry) notFound();
  const t = entry.template;
  const card = toCard(t, entry.basedOnName);
  return (
    <div className="app-page">
      <Link href="/workout/library" className="cp-back">
        <ArrowLeft size={14} /> Program library
      </Link>
      <PageHeader eyebrow={byline(card)} title={t.name} subtitle={`${cardLine(card)}. ${card.levelLabel} level. ${ENGINE_LABEL[t.engine.key]}.`} />
      <div className="pv-meta">
        <p>{t.description}</p>
        <p>{t.who}</p>
        {t.warning && (
          <p className="pl-warning">
            <AlertTriangle size={14} aria-hidden /> {t.warning}
          </p>
        )}
        {t.lifts.length > 0 && (
          <p>
            Members give a max for: {t.lifts.map((l) => LIFT_LABEL[l].toLowerCase()).join(", ")}.
            {t.tmPct !== 1 ? ` Percentages are of a training max set at ${Math.round(t.tmPct * 1000) / 10}% of that max.` : ""}
          </p>
        )}
        {entry.hidden && <p>Hidden from your members.</p>}
      </div>
      <ProgramPreviewTable weeks={previewProgram(t)} />
    </div>
  );
}
