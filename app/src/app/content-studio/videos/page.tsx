import Link from "next/link";
import { Clapperboard, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { listProjects } from "@/lib/video/projects";
import { ProjectList } from "@/components/content-studio/ProjectList";

export const dynamic = "force-dynamic";

export default async function ContentStudioVideosPage() {
  const projects = listProjects();
  return (
    <>
      <PageHeader
        eyebrow="AI Video"
        title="Videos"
        subtitle="Upload a main video plus optional B-roll. We transcribe with Whisper and auto-cut a reel with burned-in captions."
        actions={
          <Link href="/content-studio/videos/new">
            <Button>
              <Plus size={15} />
              New video
            </Button>
          </Link>
        }
      />
      {projects.length === 0 ? (
        <EmptyState
          icon={<Clapperboard size={32} strokeWidth={1.4} />}
          title="No video projects yet"
          message="Upload your first clip to see the transcript come back."
          action={
            <Link href="/content-studio/videos/new">
              <Button>
                <Plus size={15} />
                New video
              </Button>
            </Link>
          }
        />
      ) : (
        <ProjectList projects={projects} />
      )}
    </>
  );
}
