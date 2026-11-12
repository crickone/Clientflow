// app/src/app/app/programs/built/new/page.tsx
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { requireProgramsPage } from "@/lib/programs/access";
import { byline, toCard } from "@/lib/programs/cards";
import { liveEnrolment } from "@/lib/programs/enrolments";
import { memberPrograms } from "@/lib/programs/library";
import { parseStartFrom, startingDraft } from "@/lib/programs/memberPrograms";
import { PkCard, PkHeader, PkSection } from "@/components/clientapp/programs/kit";
import { MemberProgramBuilder } from "@/components/clientapp/MemberProgramBuilder";

export const dynamic = "force-dynamic";

function Choice({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <PkCard href={href}>
      <div className="pk-row">
        <div>
          <h3 className="pk-card-title">{title}</h3>
          <span className="pk-small">{sub}</span>
        </div>
        <ChevronRight size={18} aria-hidden className="pk-chev" />
      </div>
    </PkCard>
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
      <div className="pk">
        <PkHeader title="Build your own" lead="Nothing is kept until you save." />
        <MemberProgramBuilder id={null} from={from} initial={draft.template} initialUnit={unit} stepKg={client.plateStepKg > 0 ? client.plateStepKg : 2.5} running={false} current={{}} />
      </div>
    );
  }

  const live = liveEnrolment(clientId);
  const library = memberPrograms();
  return (
    <div className="pk">
      <PkHeader title="Build your own" lead="Start blank or from a program you know." />
      <Choice href="/app/programs/built/new?from=blank" title="Start blank" sub="One week, one day. Add your own exercises." />
      {live && <Choice href="/app/programs/built/new?from=current" title="Start from my current program" sub={`${live.template.name}, with your weights and maxes.`} />}
      <PkSection label="Or copy a library program">
        {library.map((e) => (
          <Choice key={e.template.key} href={`/app/programs/built/new?from=${encodeURIComponent(e.template.key)}`} title={e.template.name} sub={byline(toCard(e.template, e.basedOnName))} />
        ))}
      </PkSection>
    </div>
  );
}
