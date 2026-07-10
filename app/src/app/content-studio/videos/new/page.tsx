import { PageHeader } from "@/components/layout/PageHeader";
import { NewProjectForm } from "@/components/content-studio/NewProjectForm";

export default function NewVideoPage() {
  return (
    <>
      <PageHeader
        eyebrow="New video"
        title="Upload Clips"
        subtitle="Drop your main talking-head clip and (optionally) any B-roll. Whisper transcribes the main video so we can plan the cut."
      />
      <NewProjectForm />
    </>
  );
}
