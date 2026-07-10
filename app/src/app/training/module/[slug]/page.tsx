import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { TrainingNav } from "@/components/training/TrainingNav";
import { LESSONS, THERAPIES } from "@/lib/training/content";
import { ModuleClient } from "./ModuleClient";

export function generateStaticParams() {
  return LESSONS.map((l) => ({ slug: l.slug }));
}

export const dynamicParams = false;

export default function ModulePage({ params }: { params: { slug: string } }) {
  const lesson = LESSONS.find((l) => l.slug === params.slug);
  if (!lesson) notFound();

  const idx = LESSONS.findIndex((l) => l.slug === lesson.slug);
  const prev = idx > 0 ? LESSONS[idx - 1] : null;
  const next = idx < LESSONS.length - 1 ? LESSONS[idx + 1] : null;

  // Therapies module gets the therapy profiles inlined
  const therapies = lesson.slug === "therapies" ? THERAPIES : null;

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
