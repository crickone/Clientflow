import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { resolveFormBySlug } from "@/lib/publicForms";
import { PublicFormView } from "@/components/forms/PublicFormView";

// Public, unauthenticated, tenant resolved from the slug (never a session) —
// see lib/publicForms.ts. Batch 4c, improvement-plan-2026-08.md Theme D5.
export const dynamic = "force-dynamic";

type Props = {
  params: { slug: string };
  searchParams: { ok?: string; err?: string };
};

export function generateMetadata({ params }: Props): Metadata {
  const resolved = resolveFormBySlug(params.slug);
  if (!resolved) return { title: "Form" };
  return {
    title: resolved.form.title ? `${resolved.form.title} — ${resolved.tenantName}` : resolved.tenantName,
    robots: { index: false, follow: false }, // a lead form has nothing worth indexing
  };
}

export default function PublicFormPage({ params, searchParams }: Props) {
  const resolved = resolveFormBySlug(params.slug);
  // Unknown slug, deleted form, deactivated tenant, or the owner switched the
  // form off — all read as "not found" to a public visitor.
  if (!resolved) notFound();

  return (
    <PublicFormView
      slug={params.slug}
      tenantName={resolved.tenantName}
      form={resolved.form}
      initialOk={searchParams.ok === "1"}
      initialError={searchParams.err}
    />
  );
}
