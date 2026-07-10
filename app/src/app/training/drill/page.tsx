import { PageHeader } from "@/components/layout/PageHeader";
import { TrainingNav } from "@/components/training/TrainingNav";
import { DrillClient } from "./DrillClient";
import { FLASHCARDS } from "@/lib/training/content";

export const metadata = { title: "Script Drills — Renova Training" };

export default function DrillPage() {
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Drill mode"
        title="Script flashcards"
        subtitle="Flip, recite, mark mastered. Repeat until the scripts roll off the tongue without thinking."
      />
      <TrainingNav />
      <DrillClient cards={FLASHCARDS} />
    </div>
  );
}
