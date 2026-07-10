import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { getAssets, getProject } from "@/lib/video/projects";
import { ProjectDetail } from "@/components/content-studio/ProjectDetail";
import { VideoEditor } from "@/components/content-studio/editor/VideoEditor";
import { synthesizeTimeline } from "@/lib/video/firstCut";
import { parseTimeline } from "@/lib/video/timeline";
import { CAPTION_FONTS } from "@/lib/video/captions";
import type { Transcript } from "@/lib/ai/transcribe";

export const dynamic = "force-dynamic";

export default function VideoProjectPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const project = getProject(id);
  if (!project) notFound();
  const assets = getAssets(id);

  // Once a transcript exists, the project enters the CapCut-style editor.
  // Before that (uploading / transcribing), keep the original status flow.
  let body;
  if (project.transcriptJson) {
    const transcript = JSON.parse(project.transcriptJson) as Transcript;
    const persisted = parseTimeline(project.timelineJson);
    const timeline = persisted ?? synthesizeTimeline(project, transcript);
    body = (
      <VideoEditor
        initialProject={project}
        initialAssets={assets}
        initialTimeline={timeline}
        timelinePersisted={!!persisted}
        transcript={transcript}
        captionFonts={CAPTION_FONTS.map((f) => ({ name: f.name, label: f.label }))}
      />
    );
  } else {
    body = <ProjectDetail initialProject={project} initialAssets={assets} />;
  }

  return (
    <>
      <PageHeader
        eyebrow={`Video #${project.id}`}
        title={project.name}
        subtitle={`${project.aspectRatio} · ${project.targetSeconds}s target`}
        actions={
          <Link href="/content-studio/videos">
            <Button variant="outline">
              <ArrowLeft size={15} />
              All videos
            </Button>
          </Link>
        }
      />
      {body}
    </>
  );
}
