// app/src/app/app/programs/page.tsx
import { requireProgramsPage } from "@/lib/programs/access";
import { parseFilter, toStoryCard } from "@/lib/programs/cards";
import { programContent } from "@/lib/programs/content";
import { liveEnrolment } from "@/lib/programs/enrolments";
import { memberPrograms } from "@/lib/programs/library";
import { listMemberPrograms } from "@/lib/programs/memberPrograms";
import { memberLine, parseMemberKey } from "@/lib/programs/memberTemplate";
import { weekLabel } from "@/lib/programs/planner";
import { PkHeader } from "@/components/clientapp/programs/kit";
import { BuiltProgramList } from "@/components/clientapp/BuiltProgramList";
import { ProgramBrowser } from "@/components/clientapp/ProgramBrowser";

export const dynamic = "force-dynamic";

type Search = { goal?: string | string[]; days?: string | string[]; length?: string | string[] };

export default async function ProgramsPage(props: { searchParams: Promise<Search> }) {
  const sp = await props.searchParams;
  const { clientId } = requireProgramsPage();
  const cards = memberPrograms().map((e) =>
    toStoryCard(e.template, programContent(e.template, e.copyId !== null ? { kind: "copy", basedOnName: e.basedOnName ?? e.template.name } : { kind: "platform" }), e.basedOnName),
  );
  const live = liveEnrolment(clientId);
  const runningOwn = live?.programKey ? parseMemberKey(live.programKey) : null;
  const built = listMemberPrograms(clientId).map((p) => ({ id: p.id, name: p.name, line: memberLine(p.template), running: runningOwn === p.id }));
  const current = live ? { name: live.template.name, line: live.status === "paused" ? "Paused while you're coach guided" : weekLabel(live.template, live.state) } : null;
  return (
    <div className="pk">
      <PkHeader title="Programs" lead="Well-known programs, with your weights worked out." />
      <ProgramBrowser cards={cards} initial={parseFilter(sp)}>
        <BuiltProgramList current={current} programs={built} anyLive={!!live} />
      </ProgramBrowser>
    </div>
  );
}
