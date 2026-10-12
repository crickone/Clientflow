import { PageHeader } from "@/components/layout/PageHeader";
import { TrainingNav } from "@/components/training/TrainingNav";
import { DrillClient } from "./DrillClient";
import { FLASHCARDS } from "@/lib/training/content";
import { forClinic } from "@/lib/training/clinic";

export const dynamic = "force-dynamic";
export const metadata = { title: "Script Drills" };

export default function DrillPage() {
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Drill mode"
        title="Script flashcards"
        subtitle="Flip, recite, mark mastered. Repeat until the scripts roll off the tongue without thinking."
      />
      <TrainingNav />
      <DrillClient cards={forClinic(FLASHCARDS)} />
    </div>
  );
}
