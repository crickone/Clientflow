// app/src/app/app/programs/built/new/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { requireProgramsPage } from "@/lib/programs/access";
import { byline, toCard } from "@/lib/programs/cards";
import { liveEnrolment } from "@/lib/programs/enrolments";
import { memberPrograms } from "@/lib/programs/library";
import { parseStartFrom, startingDraft } from "@/lib/programs/memberPrograms";
import { Card, PageTitle, SectionTitle } from "@/components/clientapp/ui";
import { MemberProgramBuilder } from "@/components/clientapp/MemberProgramBuilder";

export const dynamic = "force-dynamic";

function Choice({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <Link href={href}>
      <Card style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 44 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{title}</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.45 }}>{sub}</div>
        </div>
        <ChevronRight size={18} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
      </Card>
    </Link>
  );
}

/** Pick a starting point, then build. Nothing is saved until the member presses Save. */
export default async function NewBuiltProgramPage(props: { searchParams: Promise<{ from?: string | string[] }> }) {
  const sp = await props.searchParams;
  const from = Array.isArray(sp.from) ? sp.from[0] : sp.from;
  const { clientId, client } = requireProgramsPage();
  const unit = client.weightUnit === "lb" ? "lb" : "kg";

  if (from) {
    const parsed = parseStartFrom(from);
    const draft = parsed ? startingDraft(clientId, parsed) : null;
    if (!draft) notFound();
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <PageTitle sub="Nothing is kept until you save">Build your own</PageTitle>
        <MemberProgramBuilder id={null} from={from} initial={draft.template} initialUnit={unit} running={false} current={{}} />
      </div>
    );
  }

  const live = liveEnrolment(clientId);
  const library = memberPrograms();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub="Start blank or from a program you know">Build your own</PageTitle>
      <Choice href="/app/programs/built/new?from=blank" title="Start blank" sub="One week, one day. Add your own exercises." />
      {live && <Choice href="/app/programs/built/new?from=current" title="Start from my current program" sub={`${live.template.name}, with your weights and maxes.`} />}
      <SectionTitle>Or copy a library program</SectionTitle>
      {library.map((e) => (
        <Choice key={e.template.key} href={`/app/programs/built/new?from=${encodeURIComponent(e.template.key)}`} title={e.template.name} sub={byline(toCard(e.template, e.basedOnName))} />
      ))}
    </div>
  );
}
