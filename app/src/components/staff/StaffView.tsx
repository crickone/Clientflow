"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { Reveal, RevealGroup } from "@/components/motion/Reveal";
import { initialsOf } from "@/lib/utils";
import type { PayrollRow, PerformanceRow } from "@/lib/staff";
import {
  createStaffAction,
  deleteStaffAction,
  setStaffPayAction,
  updateStaffAction,
} from "@/app/staff/actions";

// ── shapes ────────────────────────────────────────────────────────────────────

type PayType = "per_session" | "per_hour" | "fixed";

export interface RosterItem {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  payType: PayType;
  payRateCents: number;
  isApproved: boolean;
  isActive: boolean;
  notes: string | null;
}

const PAY_TYPE_LABEL: Record<PayType, string> = {
  per_session: "Per session",
  per_hour: "Per hour",
  fixed: "Fixed",
};

// ── formatting ────────────────────────────────────────────────────────────────

function euros(cents: number) {
  return `€${(cents / 100).toLocaleString("en-IE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
function initials(name: string) {
  const [a, b = ""] = name.trim().split(/\s+/);
  return initialsOf(a ?? "", b) || "?";
}

// ── main view ─────────────────────────────────────────────────────────────────

export function StaffView({
  roster,
  payroll,
  performance,
  payFrom,
  payTo,
  perfFrom,
  perfTo,
}: {
  roster: RosterItem[];
  payroll: PayrollRow[];
  performance: PerformanceRow[];
  payFrom: string;
  payTo: string;
  perfFrom: string;
  perfTo: string;
}) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<RosterItem | null>(null);

  const rosterById = useMemo(() => {
    const m = new Map<number, RosterItem>();
    for (const r of roster) m.set(r.id, r);
    return m;
  }, [roster]);

  const pushRange = (params: Record<string, string>) => {
    const sp = new URLSearchParams({ payFrom, payTo, perfFrom, perfTo, ...params });
    router.push(`/staff?${sp.toString()}`, { scroll: false });
  };

  const openCreate = () => {
    setEditing(null);
    setSheetOpen(true);
  };

  const payrollTotal = payroll.reduce((sum, r) => sum + r.grossCents, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      {/* roster */}
      <div>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <h3 style={sectionTitle}>Team</h3>
          <span style={{ marginLeft: 10, fontSize: 12, color: "var(--text-tertiary)" }}>{roster.length}</span>
          <Button style={{ marginLeft: "auto" }} onClick={openCreate}>
            <Plus size={15} />
            New staff
          </Button>
        </div>

        {roster.length === 0 ? (
          <div style={emptyBox}>No staff yet. Add your instructors to track payroll and performance.</div>
        ) : (
          <RevealGroup style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
            {roster.map((s) => (
              <Reveal key={s.id}>
                <button onClick={() => { setEditing(s); setSheetOpen(true); }} style={{ ...card, width: "100%", height: "100%" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                    <Avatar initials={initials(s.name)} size={40} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 500, color: "var(--text-primary)", ...clip }}>{s.name}</div>
                      <div style={{ fontSize: 12, color: "var(--text-tertiary)", ...clip }}>{s.title || "Instructor"}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
                    {s.isActive
                      ? <span style={pill("rgba(34,197,94,0.14)", "#22c55e")}>Active</span>
                      : <span style={pill("rgba(255,255,255,0.06)", "var(--text-tertiary)")}>Inactive</span>}
                    {s.isApproved
                      ? <span style={pill("rgba(59,130,246,0.16)", "#60a5fa")}>Approved</span>
                      : <span style={pill("rgba(234,179,8,0.14)", "#eab308")}>Pending</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 10 }}>
                    {PAY_TYPE_LABEL[s.payType]} · {euros(s.payRateCents)}
                  </div>
                </button>
              </Reveal>
            ))}
          </RevealGroup>
        )}
      </div>

      {/* payroll */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <h3 style={sectionTitle}>Payroll</h3>
          <div style={{ marginLeft: "auto" }}>
            <RangeControls
              from={payFrom}
              to={payTo}
              onChange={(from, to) => pushRange({ payFrom: from, payTo: to })}
            />
          </div>
        </div>

        <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 720 }}>
              <div style={{ ...payRow, ...headRow }}>
                <div>Staff member</div>
                <div>Pay amount</div>
                <div>Pay type</div>
                <div style={{ textAlign: "right" }}>Gross pay</div>
              </div>
              {payroll.length === 0 && <div style={emptyRow}>No staff to pay.</div>}
              {payroll.map((r) => (
                <PayrollRowEditor
                  key={r.staffId}
                  row={r}
                  staffName={rosterById.get(r.staffId)?.name ?? r.name}
                  onSaved={() => router.refresh()}
                />
              ))}
              {payroll.length > 0 && (
                <div style={{ ...payRow, background: "var(--surface-1)", fontSize: 13 }}>
                  <div style={{ color: "var(--text-tertiary)" }}>Total</div>
                  <div />
                  <div />
                  <div style={{ textAlign: "right", fontFamily: "var(--font-heading), sans-serif", fontSize: 16 }}>
                    {euros(payrollTotal)}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* performance */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <h3 style={sectionTitle}>Performance</h3>
          <div style={{ marginLeft: "auto" }}>
            <RangeControls
              from={perfFrom}
              to={perfTo}
              onChange={(from, to) => pushRange({ perfFrom: from, perfTo: to })}
            />
          </div>
        </div>

        <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 760 }}>
              <div style={{ ...perfRow, ...headRow }}>
                <div>Staff member</div>
                <div style={{ textAlign: "right" }}>Sessions</div>
                <div style={{ textAlign: "right" }}>Bookings</div>
                <div style={{ textAlign: "right" }}>Booking %</div>
                <div style={{ textAlign: "right" }}>Cancellations</div>
                <div style={{ textAlign: "right" }}>Cancel %</div>
              </div>
              {performance.length === 0 && <div style={emptyRow}>No staff to report on.</div>}
              {performance.map((r) => (
                <div key={r.staffId} style={perfRow}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <Avatar initials={initials(r.name)} size={26} />
                    <span style={clip}>{r.name}</span>
                  </div>
                  <div style={num}>{r.sessions}</div>
                  <div style={num}>{r.bookings}</div>
                  <div style={num}>{r.bookingPct}%</div>
                  <div style={num}>{r.cancellations}</div>
                  <div style={num}>{r.cancellationPct}%</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <p style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 10, lineHeight: 1.6 }}>
          Metrics are matched to timetable sessions by instructor name. Set a staff member&apos;s name to match the
          instructor on their classes.
        </p>
      </div>

      <StaffSheet
        open={sheetOpen}
        editing={editing}
        onClose={() => setSheetOpen(false)}
        onSaved={() => { setSheetOpen(false); router.refresh(); }}
      />
    </div>
  );
}

// ── inline payroll row ────────────────────────────────────────────────────────

function PayrollRowEditor({
  row,
  staffName,
  onSaved,
}: {
  row: PayrollRow;
  staffName: string;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [amount, setAmount] = useState((row.payRateCents / 100).toString());
  const [payType, setPayType] = useState<PayType>(row.payType);

  const commit = (nextType: PayType, nextAmountStr: string) => {
    const cents = Math.round((parseFloat(nextAmountStr) || 0) * 100);
    if (cents === row.payRateCents && nextType === row.payType) return;
    start(async () => {
      const res = await setStaffPayAction(row.staffId, nextType, cents);
      if (res.ok) onSaved();
      else toast.error(res.error);
    });
  };

  const unit = payType === "per_session" ? "/session" : payType === "per_hour" ? "/hour" : "fixed";
  const basis =
    row.payType === "per_session"
      ? `${row.sessions} session${row.sessions === 1 ? "" : "s"}`
      : row.payType === "per_hour"
        ? `${row.hours} hr${row.hours === 1 ? "" : "s"}`
        : "flat rate";

  return (
    <div style={{ ...payRow, opacity: pending ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <Avatar initials={initials(staffName)} size={26} />
        <span style={clip}>{staffName}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "var(--text-tertiary)", fontSize: 13 }}>€</span>
        <input
          type="number"
          min={0}
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={() => commit(payType, amount)}
          style={inlineInput}
        />
        <span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>{unit}</span>
      </div>
      <div>
        <select
          value={payType}
          onChange={(e) => {
            const next = e.target.value as PayType;
            setPayType(next);
            commit(next, amount);
          }}
          style={inlineSelect}
        >
          <option value="per_session">Per session</option>
          <option value="per_hour">Per hour</option>
          <option value="fixed">Fixed</option>
        </select>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: 15 }}>{euros(row.grossCents)}</div>
        <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{basis}</div>
      </div>
    </div>
  );
}

// ── date range control ────────────────────────────────────────────────────────

function RangeControls({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input type="date" value={from} onChange={(e) => onChange(e.target.value, to)} style={inlineDate} aria-label="From" />
      <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>→</span>
      <input type="date" value={to} onChange={(e) => onChange(from, e.target.value)} style={inlineDate} aria-label="To" />
    </div>
  );
}

// ── create / edit slide-over ──────────────────────────────────────────────────

function StaffSheet({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: RosterItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [payType, setPayType] = useState<PayType>("per_session");
  const [price, setPrice] = useState("0");
  const [isApproved, setIsApproved] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState("");

  const [seededId, setSeededId] = useState<number | "new" | null>(null);
  const key = editing ? editing.id : "new";
  if (open && seededId !== key) {
    setSeededId(key);
    setName(editing?.name ?? "");
    setTitle(editing?.title ?? "");
    setEmail(editing?.email ?? "");
    setPhone(editing?.phone ?? "");
    setPayType(editing?.payType ?? "per_session");
    setPrice(editing ? (editing.payRateCents / 100).toString() : "0");
    setIsApproved(editing?.isApproved ?? true);
    setIsActive(editing?.isActive ?? true);
    setNotes(editing?.notes ?? "");
  }
  if (!open && seededId !== null) setSeededId(null);

  const submit = () => {
    if (!name.trim()) return toast.error("Give the staff member a name.");
    const payload = {
      name,
      title: title || null,
      email: email || null,
      phone: phone || null,
      payType,
      payRateCents: Math.round((parseFloat(price) || 0) * 100),
      isApproved,
      isActive,
      notes: notes || null,
    };
    start(async () => {
      const res = editing
        ? await updateStaffAction(editing.id, payload)
        : await createStaffAction(payload);
      if (res.ok) {
        toast.success(editing ? "Staff updated." : "Staff added.");
        onSaved();
      } else {
        toast.error(res.error);
      }
    });
  };

  const remove = () => {
    if (!editing) return;
    start(async () => {
      await deleteStaffAction(editing.id);
      toast.success("Staff removed.");
      onSaved();
    });
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={editing ? "Edit staff" : "New staff"} width={460}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <Label htmlFor="s-name">Name</Label>
            <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Coach Mark" autoFocus />
          </div>
          <div>
            <Label htmlFor="s-title">Title</Label>
            <Input id="s-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Head Coach" />
          </div>
          <div>
            <Label htmlFor="s-email">Email</Label>
            <Input id="s-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@studio.ie" />
          </div>
          <div>
            <Label htmlFor="s-phone">Phone</Label>
            <Input id="s-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="083…" />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <Label htmlFor="s-paytype">Pay type</Label>
              <select id="s-paytype" value={payType} onChange={(e) => setPayType(e.target.value as PayType)} style={selectStyle}>
                <option value="per_session">Per session</option>
                <option value="per_hour">Per hour</option>
                <option value="fixed">Fixed</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <Label htmlFor="s-rate">Rate (€)</Label>
              <Input id="s-rate" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
          </div>

          <Toggle on={isActive} onChange={setIsActive} label="Active" hint="Currently teaching" />
          <Toggle on={isApproved} onChange={setIsApproved} label="Approved" hint="Cleared to run classes" />

          <div>
            <Label htmlFor="s-notes">Notes</Label>
            <Textarea id="s-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center", paddingTop: 4 }}>
            {editing ? (
              <Button variant="ghost" onClick={remove} disabled={pending} aria-label="Delete staff">
                <Trash2 size={14} />
              </Button>
            ) : (
              <span />
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
              <Button onClick={submit} disabled={pending}>
                {pending ? "Saving…" : editing ? "Save changes" : "Add staff"}
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── bits ──────────────────────────────────────────────────────────────────────

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: "var(--text-primary)" }}>{label}</div>
        {hint && <div style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>{hint}</div>}
      </div>
      <span style={{ width: 40, height: 23, borderRadius: 999, background: on ? "var(--accent)" : "var(--surface-2)", border: "1px solid var(--hairline)", position: "relative", flexShrink: 0, transition: "background 0.15s var(--ease)" }}>
        <span style={{ position: "absolute", top: 2, left: on ? 19 : 2, width: 17, height: 17, borderRadius: "50%", background: "#fff", transition: "left 0.15s var(--ease)" }} />
      </span>
    </button>
  );
}

function pill(bg: string, fg: string): React.CSSProperties {
  return {
    display: "inline-block",
    fontSize: 10.5,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    fontFamily: "var(--font-mono), monospace",
    padding: "2px 8px",
    borderRadius: 5,
    background: bg,
    color: fg,
  };
}

const sectionTitle: React.CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-heading), sans-serif",
  fontSize: 16,
  textTransform: "uppercase",
  letterSpacing: "0.02em",
};
const card: React.CSSProperties = {
  position: "relative",
  textAlign: "left",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
  background: "var(--surface-1)",
  padding: 16,
  cursor: "pointer",
};
const emptyBox: React.CSSProperties = {
  border: "1px dashed var(--hairline)",
  borderRadius: "var(--radius)",
  padding: "26px 20px",
  textAlign: "center",
  color: "var(--text-tertiary)",
  fontSize: 13,
  lineHeight: 1.6,
};
const emptyRow: React.CSSProperties = {
  padding: "26px 16px",
  textAlign: "center",
  color: "var(--text-tertiary)",
  fontSize: 13,
};
const payRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.6fr 1.3fr 1.1fr 1fr",
  gap: 10,
  padding: "11px 16px",
  borderBottom: "1px solid var(--hairline)",
  alignItems: "center",
  fontSize: 13,
};
const perfRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.8fr 1fr 1fr 1fr 1.2fr 1fr",
  gap: 10,
  padding: "11px 16px",
  borderBottom: "1px solid var(--hairline)",
  alignItems: "center",
  fontSize: 13,
};
const headRow: React.CSSProperties = {
  background: "var(--surface-1)",
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-tertiary)",
  fontFamily: "var(--font-mono), monospace",
};
const num: React.CSSProperties = {
  textAlign: "right",
  fontFamily: "var(--font-mono), monospace",
  fontSize: 12.5,
  fontVariantNumeric: "tabular-nums",
};
const clip: React.CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const selectStyle: React.CSSProperties = {
  height: 38,
  width: "100%",
  padding: "0 12px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "var(--surface-1)",
  color: "var(--text-primary)",
  fontSize: 13,
};
const inlineInput: React.CSSProperties = {
  width: 90,
  height: 34,
  padding: "0 10px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "var(--surface-2)",
  color: "var(--text-primary)",
  fontSize: 13,
};
const inlineSelect: React.CSSProperties = {
  height: 34,
  padding: "0 8px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "var(--surface-2)",
  color: "var(--text-primary)",
  fontSize: 12.5,
};
const inlineDate: React.CSSProperties = {
  height: 34,
  padding: "0 8px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "var(--surface-1)",
  color: "var(--text-primary)",
  fontSize: 12.5,
};
