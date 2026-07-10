import { PageHeader } from "@/components/layout/PageHeader";
import { TrainingNav } from "@/components/training/TrainingNav";
import { LookupClient } from "./LookupClient";
import { CONDITIONS, CONDITION_CATEGORIES } from "@/lib/training/content";

export const metadata = { title: "Condition Lookup — Renova Training" };

export default function LookupPage() {
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Reference tool"
        title="Condition → Therapy"
        subtitle="Search any condition a caller mentions. See the recommended therapy combination and the exact line to lead with."
      />
      <TrainingNav />
      <LookupClient conditions={CONDITIONS} categories={CONDITION_CATEGORIES} />
    </div>
  );
}
