// app/src/app/app/programs/page.tsx
import { requireProgramsPage } from "@/lib/programs/access";
import { toCard } from "@/lib/programs/cards";
import { liveEnrolment } from "@/lib/programs/enrolments";
import { memberPrograms } from "@/lib/programs/library";
import { listMemberPrograms } from "@/lib/programs/memberPrograms";
import { memberKey, memberLine } from "@/lib/programs/memberTemplate";
import { PageTitle } from "@/components/clientapp/ui";
import { BuiltProgramList } from "@/components/clientapp/BuiltProgramList";
import { ProgramBrowser } from "@/components/clientapp/ProgramBrowser";

export const dynamic = "force-dynamic";

export default async function ProgramsPage() {
  const { clientId } = requireProgramsPage();
  const cards = memberPrograms().map((e) => toCard(e.template, e.basedOnName));
  const live = liveEnrolment(clientId);
  const built = listMemberPrograms(clientId).map((p) => ({ id: p.id, name: p.name, line: memberLine(p.template), running: live?.programKey === memberKey(p.id) }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle sub="Well-known programs, with your weights worked out">Programs</PageTitle>
      <BuiltProgramList programs={built} anyLive={!!live} />
      <ProgramBrowser cards={cards} current={live ? { name: live.template.name, paused: live.status === "paused" } : null} />
    </div>
  );
}
