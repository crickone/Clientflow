import { PageHeader } from "@/components/layout/PageHeader";
import { TrainingNav } from "@/components/training/TrainingNav";
import { RoleplayClient } from "./RoleplayClient";
import { ROLEPLAYS } from "@/lib/training/content";
import { forClinic } from "@/lib/training/clinic";

export const dynamic = "force-dynamic";
export const metadata = { title: "Roleplay" };

export default function RoleplayPage() {
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Practice"
        title="Call roleplay"
        subtitle="Branching scenarios with real callers, real curveballs. Pick the response you'd give live. Get feedback on every choice."
      />
      <TrainingNav />
      <RoleplayClient scenarios={forClinic(ROLEPLAYS)} />
    </div>
  );
}
