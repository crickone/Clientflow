"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { BellRing, Clock, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { saveLeadFollowUpsAction } from "@/app/settings/lead-follow-ups/actions";
import type { LeadFlowSettings } from "@/lib/leadFlows/settingsModel";

const DAYS: { d: number; label: string }[] = [
  { d: 1, label: "Mon" },
  { d: 2, label: "Tue" },
  { d: 3, label: "Wed" },
  { d: 4, label: "Thu" },
  { d: 5, label: "Fri" },
  { d: 6, label: "Sat" },
  { d: 0, label: "Sun" },
];

export interface StaffOption {
  userId: number;
  name: string;
  /** Their mobile from the Staff roster, when it has one. */
  phone?: string | null;
}

const section: CSSProperties = { display: "flex", flexDirection: "column", gap: 12, padding: 20 };
const head: CSSProperties = { display: "flex", alignItems: "center", gap: 8, color: "var(--text-primary)" };
const note: CSSProperties = { margin: 0, fontSize: 13, lineHeight: 1.55, color: "var(--text-secondary)" };
const selectStyle: CSSProperties = {
  width: "100%",
  height: 42,
  padding: "0 12px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "var(--surface-1)",
  color: "var(--text-primary)",
  fontSize: 14,
  fontFamily: "inherit",
};
const dayStyle = (on: boolean): CSSProperties => ({
  minWidth: 56,
  padding: "9px 14px",
  borderRadius: "var(--radius)",
  border: `1px solid ${on ? "var(--accent)" : "var(--hairline)"}`,
  background: on ? "var(--accent)" : "var(--surface-1)",
  color: on ? "var(--accent-contrast)" : "var(--text-secondary)",
  fontSize: 13,
  fontWeight: on ? 600 : 500,
  fontFamily: "inherit",
  cursor: "pointer",
});

export function LeadFollowUpsForm({ initial, staff }: { initial: LeadFlowSettings; staff: StaffOption[] }) {
  // Nothing saved yet: start from today's behaviour (every day, 9am to 9pm).
  const [days, setDays] = useState<number[]>(initial.window?.days ?? [0, 1, 2, 3, 4, 5, 6]);
  const [start, setStart] = useState(initial.window?.start ?? "09:00");
  const [end, setEnd] = useState(initial.window?.end ?? "21:00");
  // A saved assignee who has left the team is not in the list: show "Nobody" so Save does not fail invisibly.
  const [assignee, setAssignee] = useState(
    initial.defaultAssigneeUserId != null && staff.some((s) => s.userId === initial.defaultAssigneeUserId) ? String(initial.defaultAssigneeUserId) : "",
  );
  const [alertTo, setAlertTo] = useState(initial.alertWhatsAppTo ?? "");
  const [alertMember, setAlertMember] = useState(
    initial.alertUserId != null && staff.some((s) => s.userId === initial.alertUserId) ? String(initial.alertUserId) : "",
  );
  const alertPerson = staff.find((s) => String(s.userId) === alertMember) ?? null;
  function pickAlertMember(value: string) {
    setAlertMember(value);
    const person = staff.find((s) => String(s.userId) === value);
    // Their saved number if it's the same person, else the Staff roster's.
    if (!person) setAlertTo("");
    else if (String(initial.alertUserId ?? "") === value && initial.alertWhatsAppTo) setAlertTo(initial.alertWhatsAppTo);
    else setAlertTo(person.phone ?? "");
  }
  const [hoursSaved, setHoursSaved] = useState(initial.window != null);
  const [saving, startSave] = useTransition();

  const toggleDay = (d: number) => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  function save() {
    startSave(async () => {
      const res = await saveLeadFollowUpsAction({
        window: { days, start, end },
        defaultAssigneeUserId: assignee ? Number(assignee) : null,
        alertWhatsAppTo: alertMember ? alertTo.trim() || null : null,
        alertUserId: alertMember ? Number(alertMember) : null,
      });
      if (res.ok) {
        setHoursSaved(true);
        toast.success("Lead follow-up settings saved.");
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        <div style={section}>
          <div style={head}>
            <Clock size={16} aria-hidden />
            <CardLabel style={{ marginBottom: 0 }}>Sending hours</CardLabel>
          </div>
          <p style={note}>
            Follow-up WhatsApps and emails only go out on these days, between these times, Irish time. A message due outside them goes at the start of the
            next sending time. Staff alerts are not held back.
          </p>
          {!hoursSaved && (
            <p style={{ ...note, color: "var(--text-primary)" }}>Not saved yet. Until you save, WhatsApps go between 9am and 9pm every day and emails go at any time.</p>
          )}
          <div role="group" aria-label="Sending days" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {DAYS.map(({ d, label }) => (
              <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => toggleDay(d)} style={dayStyle(days.includes(d))}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <div style={{ flex: "1 1 160px" }}>
              <Label htmlFor="lfu-start">From</Label>
              <Input id="lfu-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div style={{ flex: "1 1 160px" }}>
              <Label htmlFor="lfu-end">Until</Label>
              <Input id="lfu-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div style={section}>
          <div style={head}>
            <UserRound size={16} aria-hidden />
            <CardLabel style={{ marginBottom: 0 }}>Assign new leads to</CardLabel>
          </div>
          <p style={note}>New leads are assigned to this person. They get their own alert for new and hot leads, and for calls you schedule. You can change it on any lead.</p>
          <Label htmlFor="lfu-assignee" srOnly>
            Assign new leads to
          </Label>
          <select id="lfu-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} style={selectStyle}>
            <option value="">Nobody</option>
            {staff.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <Card>
        <div style={section}>
          <div style={head}>
            <BellRing size={16} aria-hidden />
            <CardLabel style={{ marginBottom: 0 }}>WhatsApp alerts</CardLabel>
          </div>
          <p style={note}>
            New-lead and hot-lead alerts, and call-back reminders, go to this team member by WhatsApp from your business WhatsApp. Pick someone whose
            mobile isn't the business WhatsApp number itself.
          </p>
          <Label htmlFor="lfu-alert-member" srOnly>
            Send WhatsApp alerts to
          </Label>
          <select id="lfu-alert-member" value={alertMember} onChange={(e) => pickAlertMember(e.target.value)} style={selectStyle}>
            <option value="">No WhatsApp alerts</option>
            {staff.map((s) => (
              <option key={s.userId} value={String(s.userId)}>
                {s.name}
              </option>
            ))}
          </select>
          {alertPerson && (
            <div style={{ display: "grid", gap: 6 }}>
              <Label htmlFor="lfu-alert">{alertPerson.name}&apos;s mobile</Label>
              <Input id="lfu-alert" inputMode="tel" placeholder="Mobile number, for example 087 000 0000" value={alertTo} onChange={(e) => setAlertTo(e.target.value)} />
              {!alertPerson.phone && (
                <p style={{ ...note, fontSize: 12.5, color: "var(--text-tertiary)" }}>
                  There's no mobile for {alertPerson.name} on the Staff page, so type it here.
                </p>
              )}
            </div>
          )}
        </div>
      </Card>

      <div style={{ position: "sticky", bottom: 16, display: "flex", justifyContent: "flex-end" }}>
        <Button onClick={save} loading={saving}>
          {saving ? "Saving" : "Save"}
        </Button>
      </div>
    </div>
  );
}
