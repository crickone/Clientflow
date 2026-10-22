import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { TrainingNav } from "@/components/training/TrainingNav";
import { LESSONS as BASE_LESSONS, THERAPIES } from "@/lib/training/content";
import { forClinic } from "@/lib/training/clinic";
import { ModuleClient } from "./ModuleClient";

// Rendered per request: the scripts name the signed-in clinic (forClinic).
export const dynamic = "force-dynamic";

export default async function ModulePage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const LESSONS = forClinic(BASE_LESSONS);
  const lesson = LESSONS.find((l) => l.slug === params.slug);
  if (!lesson) notFound();

  const idx = LESSONS.findIndex((l) => l.slug === lesson.slug);
  const prev = idx > 0 ? LESSONS[idx - 1] : null;
  const next = idx < LESSONS.length - 1 ? LESSONS[idx + 1] : null;

  // Therapies module gets the therapy profiles inlined
  const therapies = lesson.slug === "therapies" ? forClinic(THERAPIES) : null;

  return (
    <div className="app-page">
      <PageHeader
        eyebrow={`Module ${lesson.number} · ~${lesson.durationMin} min`}
        title={lesson.title}
        subtitle={lesson.summary}
      />
      <TrainingNav />
      <ModuleClient
        lesson={lesson}
        therapies={therapies}
        prev={prev ? { slug: prev.slug, title: prev.title } : null}
        next={next ? { slug: next.slug, title: next.title } : null}
      />
    </div>
  );
}
