import { PageHeader } from "@/components/layout/PageHeader";
import { TrainingNav } from "@/components/training/TrainingNav";
import { OverviewClient } from "./OverviewClient";
import { LESSONS, FLASHCARDS, ROLEPLAYS } from "@/lib/training/content";

export const metadata = { title: "Sales Training — Renova" };

export default function TrainingHome() {
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Training"
        title="Sales Agent Programme"
        subtitle="The complete guide to helping clients find the right therapy at Renova. Work through the modules, take the quizzes, drill the scripts, run the roleplays."
      />
      <TrainingNav />
      <OverviewClient
        lessons={LESSONS.map((l) => ({
          slug: l.slug,
          number: l.number,
          title: l.title,
          summary: l.summary,
          durationMin: l.durationMin,
          quizCount: l.quiz.length,
        }))}
        totalFlashcards={FLASHCARDS.length}
        totalRoleplays={ROLEPLAYS.length}
      />
    </div>
  );
}
