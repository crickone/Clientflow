import { notFound } from "next/navigation";

import { requireClientPage } from "@/lib/clientAuth";
import { exerciseHistory, getSession } from "@/lib/workoutLog";
import { WorkoutLogger } from "@/components/clientapp/WorkoutLogger";

export const dynamic = "force-dynamic";

export default async function WorkoutLogPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { clientId } = requireClientPage();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  // getSession is the ownership check: another member's session id is null.
  const session = getSession(clientId, id);
  if (!session) notFound();
  const { previous, previousAt } = exerciseHistory(clientId, session.exercises.map((e) => e.exerciseKey), session.id, session.startedAt);
  return <WorkoutLogger session={session} previous={previous} previousAt={previousAt} />;
}
