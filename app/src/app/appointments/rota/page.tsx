import { RotaView } from "@/components/appointments/rota/RotaView";
import { getCurrentMembership, requireUserPage } from "@/lib/auth";
import { dublinDay } from "@/lib/cashModel";
import { isIsoDate, mondayOf } from "@/lib/scheduling/rotaModel";
import { loadRotaWeek } from "@/lib/scheduling/rotaRepo";

import {
  addPersonAction,
  addShiftAction,
  copyLastWeekAction,
  deleteShiftAction,
  setRotaOnAction,
  setStaffingAction,
  updateShiftAction,
} from "./actions";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ week?: string }>;
}

export default async function RotaPage(props: Props) {
  await requireUserPage();
  const role = getCurrentMembership()?.role;
  const sp = await props.searchParams;
  const monday = sp.week && isIsoDate(sp.week) ? mondayOf(sp.week) : mondayOf(dublinDay(Date.now()));

  return (
    <div className="app-page">
      <RotaView
        data={loadRotaWeek(monday)}
        isAdmin={role === "admin"}
        actions={{
          addShift: addShiftAction,
          updateShift: updateShiftAction,
          deleteShift: deleteShiftAction,
          copyLastWeek: copyLastWeekAction,
          addPerson: addPersonAction,
          setRotaOn: setRotaOnAction,
          setStaffing: setStaffingAction,
        }}
      />
    </div>
  );
}
