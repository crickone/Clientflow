"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dumbbell, KeyRound, Plus, Salad, Send, Smartphone, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Input, Label } from "@/components/ui/Input";
import {
  assignNutritionAction,
  assignWorkoutAction,
  enableClientLoginAction,
  removeClientLoginAction,
  resetClientPasswordAction,
  sendClientLoginEmailAction,
  setClientLoginActiveAction,
  unassignNutritionAction,
  unassignWorkoutAction,
} from "@/app/clients/appAccessActions";

interface LoginInfo {
  email: string;
  isActive: boolean;
  lastLoginAt: number | null;
}
interface Item {
  id: number;
  title: string;
  type: string;
}

function genPassword() {
  return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6).toUpperCase();
}

export function ClientAppAccess({
  clientId,
  clientEmail,
  login,
  assignedNutrition,
  availableNutrition,
  assignedWorkouts,
  availableWorkouts,
}: {
  clientId: number;
  clientEmail: string | null;
  login: LoginInfo | null;
  assignedNutrition: Item[];
  availableNutrition: Item[];
  assignedWorkouts: Item[];
  availableWorkouts: Item[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 620 }}>
      <LoginCard clientId={clientId} clientEmail={clientEmail} login={login} />
      <AssignCard
        title="Nutrition plans"
        icon={<Salad size={18} />}
        clientId={clientId}
        assigned={assignedNutrition}
        available={availableNutrition}
        onAssign={assignNutritionAction}
        onUnassign={unassignNutritionAction}
      />
      <AssignCard
        title="Workout programs"
        icon={<Dumbbell size={18} />}
        clientId={clientId}
        assigned={assignedWorkouts}
        available={availableWorkouts}
        onAssign={assignWorkoutAction}
        onUnassign={unassignWorkoutAction}
      />
    </div>
  );
}

function LoginCard({ clientId, clientEmail, login }: { clientId: number; clientEmail: string | null; login: LoginInfo | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const confirm = useConfirm();
  const [email, setEmail] = useState(clientEmail ?? "");
  const [password, setPassword] = useState(genPassword());
  const [resetting, setResetting] = useState(false);
  const [newPass, setNewPass] = useState("");

  const enable = () =>
    start(async () => {
      const res = await enableClientLoginAction(clientId, email, password);
      if (res.ok) {
        toast.success("App login enabled.");
        router.refresh();
      } else toast.error(res.error);
    });
  const reset = () =>
    start(async () => {
      const res = await resetClientPasswordAction(clientId, newPass || genPassword());
      if (res.ok) {
        toast.success("Password reset.");
        setResetting(false);
        setNewPass("");
      } else toast.error(res.error);
    });
  const toggle = () =>
    start(async () => {
      await setClientLoginActiveAction(clientId, !login!.isActive);
      router.refresh();
    });
  const remove = () =>
    start(async () => {
      if (!(await confirm({ title: "Remove this client's app login?", destructive: true }))) return;
      await removeClientLoginAction(clientId);
      toast.success("Login removed.");
      router.refresh();
    });
  const sendLogin = () =>
    start(async () => {
      const res = await sendClientLoginEmailAction(clientId);
      if (res.ok) {
        toast.success(`App login emailed to ${login!.email}`);
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <div style={card}>
      <Head icon={<Smartphone size={18} />} title="Client app login" />
      {!login ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
            Give this client access to the mobile app. Share the email + password below — they can change it later.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <Label htmlFor="cl-email">Login email</Label>
              <Input id="cl-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@email.com" />
            </div>
            <div>
              <Label htmlFor="cl-pass">Temporary password</Label>
              <div style={{ display: "flex", gap: 6 }}>
                <Input id="cl-pass" value={password} onChange={(e) => setPassword(e.target.value)} />
                <Button variant="outline" size="sm" onClick={() => setPassword(genPassword())} type="button">New</Button>
              </div>
            </div>
          </div>
          <div>
            <Button onClick={enable} disabled={pending}>
              <KeyRound size={14} /> {pending ? "Enabling…" : "Enable app login"}
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13.5, color: "var(--text-primary)", fontFamily: "var(--font-mono), monospace" }}>{login.email}</div>
            <span style={pill(login.isActive ? "rgba(34,197,94,0.14)" : "rgba(255,255,255,0.06)", login.isActive ? "#22c55e" : "var(--text-tertiary)")}>
              {login.isActive ? "Active" : "Disabled"}
            </span>
            <span style={{ fontSize: 12, color: "var(--text-tertiary)", marginLeft: "auto" }}>
              {login.lastLoginAt ? `Last login ${new Date(login.lastLoginAt).toLocaleDateString("en-IE", { day: "2-digit", month: "short", year: "numeric" })}` : "Never signed in"}
            </span>
          </div>

          {resetting ? (
            <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <Label htmlFor="cl-newpass">New password</Label>
                <Input id="cl-newpass" value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="At least 6 characters" />
              </div>
              <Button size="sm" onClick={reset} disabled={pending}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setResetting(false)}>Cancel</Button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button size="sm" onClick={sendLogin} disabled={pending}>
                <Send size={13} /> {pending ? "Sending…" : "Email app login"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setNewPass(genPassword()); setResetting(true); }}>
                <KeyRound size={13} /> Reset password
              </Button>
              <Button size="sm" variant="outline" onClick={toggle} disabled={pending}>
                {login.isActive ? "Disable" : "Enable"}
              </Button>
              <Button size="sm" variant="ghost" onClick={remove} disabled={pending} style={{ marginLeft: "auto" }}>
                <Trash2 size={13} /> Remove
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AssignCard({
  title,
  icon,
  clientId,
  assigned,
  available,
  onAssign,
  onUnassign,
}: {
  title: string;
  icon: React.ReactNode;
  clientId: number;
  assigned: Item[];
  available: Item[];
  onAssign: (clientId: number, itemId: number) => Promise<void>;
  onUnassign: (clientId: number, itemId: number) => Promise<void>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pick, setPick] = useState<number | "">("");

  const assignedIds = useMemo(() => new Set(assigned.map((a) => a.id)), [assigned]);
  const options = available.filter((a) => !assignedIds.has(a.id));

  const add = () => {
    if (!pick) return;
    const itemId = Number(pick);
    setPick("");
    start(async () => {
      await onAssign(clientId, itemId);
      toast.success("Assigned.");
      router.refresh();
    });
  };
  const remove = (itemId: number) =>
    start(async () => {
      await onUnassign(clientId, itemId);
      router.refresh();
    });

  return (
    <div style={card}>
      <Head icon={icon} title={title} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {assigned.length === 0 && <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>None assigned yet.</div>}
        {assigned.map((a) => (
          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", border: "1px solid var(--hairline)", borderRadius: "var(--radius)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, color: "var(--text-primary)", fontWeight: 500 }}>{a.title}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>{a.type}</div>
            </div>
            <button onClick={() => remove(a.id)} disabled={pending} aria-label="Unassign" style={{ background: "transparent", border: "none", color: "var(--text-tertiary)", cursor: "pointer" }}>
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <select value={pick} onChange={(e) => setPick(e.target.value ? Number(e.target.value) : "")} style={selectStyle}>
          <option value="">{options.length ? "Choose to assign…" : "Nothing left to assign"}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.title}</option>
          ))}
        </select>
        <Button variant="outline" size="sm" onClick={add} disabled={pending || !pick}>
          <Plus size={14} /> Assign
        </Button>
      </div>
    </div>
  );
}

function Head({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 2 }}>
      <span style={{ color: "var(--accent-ink)" }}>{icon}</span>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{title}</div>
    </div>
  );
}

function pill(bg: string, fg: string): React.CSSProperties {
  return { display: "inline-block", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.04em", fontFamily: "var(--font-mono), monospace", padding: "2px 8px", borderRadius: 5, background: bg, color: fg };
}
const card: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
  background: "var(--surface-1)",
  padding: 18,
};
const selectStyle: React.CSSProperties = {
  flex: 1,
  height: 38,
  padding: "0 12px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "var(--surface-1)",
  color: "var(--text-primary)",
  fontSize: 13,
};
