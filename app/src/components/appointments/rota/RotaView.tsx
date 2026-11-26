"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, AlertTriangle, ChevronLeft, ChevronRight, Copy, Info, Plus, UserPlus } from "lucide-react";
import { toast } from "sonner";

import type { ActionResult } from "@/app/appointments/rota/actions";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import type { LookAtItem, RotaDay, RotaPerson, RotaWeekData, ShiftRow, TreatmentStaffing } from "@/lib/scheduling/rotaModel";
import type { Staffing } from "@/lib/scheduling/staffDemand";

import { AddPersonDialog } from "./AddPersonDialog";
import { RotaCards } from "./RotaCards";
import { RotaGrid } from "./RotaGrid";
import { ShiftDialog, type ShiftTarget } from "./ShiftDialog";

/** The page's writes, passed in so a test harness can hand over fakes in place of the server actions. */
export interface RotaActions {
  addShift: (input: { staffId: number; date: string; start: string; end: string }) => Promise<ActionResult>;
  updateShift: (id: number, input: { start: string; end: string }) => Promise<ActionResult>;
  deleteShift: (id: number) => Promise<ActionResult>;
  copyLastWeek: (monday: string) => Promise<ActionResult>;
  addPerson: (name: string) => Promise<ActionResult>;
  setRotaOn: (on: boolean) => Promise<ActionResult>;
  setStaffing: (therapyId: number, staffing: Staffing) => Promise<ActionResult>;
}

interface Props {
  data: RotaWeekData;
  isAdmin: boolean;
  actions: RotaActions;
  weekHref?: (monday: string) => string;
}

type OpenDialog = ({ kind: "shift" } & ShiftTarget) | { kind: "person" } | null;

const defaultWeekHref = (m: string) => "/appointments/rota?week=" + m;

/** A thrown action (a lost session, a role change) reads as a refusal, not a crashed page. */
function safely<A extends unknown[]>(fn: (...args: A) => Promise<ActionResult>): (...args: A) => Promise<ActionResult> {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch {
      return { ok: false, error: "Could not save. Try again." };
    }
  };
}

export function RotaView({ data, isAdmin, actions: raw, weekHref = defaultWeekHref }: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const actions = useMemo<RotaActions>(
    () => ({
      addShift: safely(raw.addShift),
      updateShift: safely(raw.updateShift),
      deleteShift: safely(raw.deleteShift),
      copyLastWeek: safely(raw.copyLastWeek),
      addPerson: safely(raw.addPerson),
      setRotaOn: safely(raw.setRotaOn),
      setStaffing: safely(raw.setStaffing),
    }),
    [raw],
  );
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [copying, startCopy] = useTransition();
  const [switching, startSwitch] = useTransition();

  const onAdd = (person: RotaPerson, day: RotaDay) =>
    setDialog({ kind: "shift", personId: person.id, personName: person.name, date: day.date, open: day.open, close: day.close });
  const onEdit = (person: RotaPerson, day: RotaDay, shift: ShiftRow) =>
    setDialog({ kind: "shift", personId: person.id, personName: person.name, date: day.date, shift, open: day.open, close: day.close });
  const addPersonButton = (
    <Button type="button" variant="secondary" onClick={() => setDialog({ kind: "person" })}>
      <Plus size={15} /> Add a person
    </Button>
  );

  const copyLastWeek = async () => {
    if (copying) return;
    if (data.lastWeekShiftCount === 0) {
      toast.error("Last week has no shifts to copy.");
      return;
    }
    if (
      data.thisWeekShiftCount > 0 &&
      !(await confirm({
        title: "Replace this week's shifts?",
        body: "This week already has shifts. Copy last week replaces them with last week's.",
        confirmLabel: "Replace",
        destructive: true,
      }))
    )
      return;
    startCopy(async () => {
      const res = await actions.copyLastWeek(data.monday);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Copied.");
      router.refresh();
    });
  };

  const switchRota = async (on: boolean) => {
    if (switching) return;
    if (
      !on &&
      !(await confirm({
        title: "Stop using the rota for bookings?",
        body: "Bookings will no longer check who is on. Your shifts are kept.",
        confirmLabel: "Stop",
        destructive: true,
      }))
    )
      return;
    startSwitch(async () => {
      const res = await actions.setRotaOn(on);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(on ? "The rota is on for bookings." : "The rota is off for bookings.");
      router.refresh();
    });
  };

  return (
    <div className="rv">
      <PageHeader
        eyebrow="Schedule"
        title="Rota"
        subtitle="Who is in each day. Bookings only allow what the people on shift can cover."
        actions={
          <>
            <div className="rv-week">
              <Link href={weekHref(data.prevMonday)} className="rv-ib" aria-label="Previous week">
                <ChevronLeft size={16} />
              </Link>
              <span className="rv-week-label">{data.rangeLabel}</span>
              <Link href={weekHref(data.nextMonday)} className="rv-ib" aria-label="Next week">
                <ChevronRight size={16} />
              </Link>
            </div>
            <Button type="button" variant="secondary" onClick={copyLastWeek} loading={copying}>
              <Copy size={15} /> Copy last week
            </Button>
            {addPersonButton}
          </>
        }
      />

      {!data.rotaOn && (
        <div className="rv-banner">
          <Info size={16} aria-hidden />
          <span>Bookings do not check the rota.</span>
          {isAdmin && (
            <Button type="button" size="sm" variant="secondary" onClick={() => switchRota(true)} loading={switching}>
              Use the rota for bookings
            </Button>
          )}
        </div>
      )}
      {data.unfilled && (
        <div className="rv-banner is-warn">
          <AlertTriangle size={16} aria-hidden />
          <span>No shifts this week, so bookings assume one person on during opening hours.</span>
        </div>
      )}

      {data.people.length === 0 ? (
        <EmptyState
          icon={<UserPlus />}
          title="Add the people who work in the clinic"
          message="Then add their shifts for each week."
          action={addPersonButton}
        />
      ) : (
        <div className="rv-panel">
          <RotaGrid days={data.days} people={data.people} onAdd={onAdd} onEdit={onEdit} />
          <RotaCards days={data.days} people={data.people} onAdd={onAdd} onEdit={onEdit} />
        </div>
      )}

      <div className="rv-row2">
        <LookAtCard items={data.lookAt} rotaOn={data.rotaOn} />
        <TreatmentsCard key={data.monday} treatments={data.treatments} isAdmin={isAdmin} setStaffing={actions.setStaffing} />
      </div>

      {data.rotaOn && isAdmin && (
        <div className="rv-end">
          <Button type="button" variant="ghost" onClick={() => switchRota(false)} loading={switching}>
            Stop using the rota for bookings
          </Button>
        </div>
      )}

      {dialog?.kind === "shift" && <ShiftDialog target={dialog} actions={actions} onClose={() => setDialog(null)} />}
      {dialog?.kind === "person" && <AddPersonDialog addPerson={actions.addPerson} onClose={() => setDialog(null)} />}
    </div>
  );
}

function LookAtCard({ items, rotaOn }: { items: LookAtItem[]; rotaOn: boolean }) {
  return (
    <Card className="rv-card">
      <CardLabel>Bookings to look at this week ({items.length})</CardLabel>
      {!rotaOn ? (
        <p className="rv-muted">The rota is off, so bookings are not checked against it.</p>
      ) : items.length === 0 ? (
        <p className="rv-muted">Nothing to look at this week.</p>
      ) : (
        <div>
          {items.map((item) => (
            <div key={item.appointmentId} className="rv-clash">
              <span className="rv-clash-ic" aria-hidden>
                <AlertCircle size={15} />
              </span>
              <div>
                <b>{item.title}</b>
                <p>{item.reason} Move one, or add someone to the rota.</p>
              </div>
              <Link href={"/appointments/" + item.appointmentId} className="rv-link">
                Open
              </Link>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function TreatmentsCard({
  treatments,
  isAdmin,
  setStaffing,
}: {
  treatments: TreatmentStaffing[];
  isAdmin: boolean;
  setStaffing: RotaActions["setStaffing"];
}) {
  const router = useRouter();
  // Optimistic: the pick shows straight away and goes back if the save is refused.
  const [picked, setPicked] = useState<Record<number, Staffing>>({});

  const pick = async (t: TreatmentStaffing, value: Staffing) => {
    const before = picked[t.id] ?? t.staffing;
    if (!isAdmin || before === value) return;
    setPicked((p) => ({ ...p, [t.id]: value }));
    const res = await setStaffing(t.id, value);
    if (!res.ok) {
      setPicked((p) => ({ ...p, [t.id]: before }));
      toast.error(res.error);
      return;
    }
    router.refresh();
  };

  return (
    <Card className="rv-card">
      <CardLabel>Treatments: who they need</CardLabel>
      {treatments.length === 0 ? (
        <p className="rv-muted">No treatments yet.</p>
      ) : (
        <>
          <div>
            {treatments.map((t) => {
              const value = picked[t.id] ?? t.staffing;
              return (
                <div key={t.id} className="rv-tr">
                  <span>{t.name}</span>
                  <span className="rv-seg" role="radiogroup" aria-label={`Who ${t.name} needs`}>
                    {(
                      [
                        ["whole", "Whole time"],
                        ["setup", "Sets it up"],
                      ] as const
                    ).map(([v, label]) => (
                      <button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={value === v}
                        disabled={!isAdmin}
                        onClick={() => pick(t, v)}
                      >
                        {label}
                      </button>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
          {!isAdmin && <p className="rv-muted rv-note">Only an admin can change this.</p>}
          <p className="rv-muted rv-note">
            Whole time: a therapist is with the client throughout. Sets it up: one therapist can look after several at once.
          </p>
        </>
      )}
    </Card>
  );
}
