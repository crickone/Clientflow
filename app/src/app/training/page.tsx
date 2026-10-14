import { PageHeader } from "@/components/layout/PageHeader";
import { TrainingNav } from "@/components/training/TrainingNav";
import { OverviewClient } from "./OverviewClient";
import { LESSONS, FLASHCARDS, ROLEPLAYS } from "@/lib/training/content";
import { clinicName, forClinic } from "@/lib/training/clinic";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sales Training" };

export default function TrainingHome() {
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Sales training"
        title="Sales Agent Programme"
        subtitle={`The complete guide to helping clients find the right therapy at ${clinicName()}. Work through the modules, take the quizzes, drill the scripts, run the roleplays.`}
      />
      <TrainingNav />
      <OverviewClient
        lessons={forClinic(LESSONS).map((l) => ({
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
