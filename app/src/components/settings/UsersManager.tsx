"use client";

import { useState, useTransition } from "react";
import { KeyRound, Mail, Pencil, Plus, UserMinus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/Dialog";
import { FieldError, Input, Label } from "@/components/ui/Input";
import {
  createUserAction,
  lookupIdentityAction,
  removeMembershipAction,
  resendInviteAction,
  resetPasswordAction,
  updateMemberEmailAction,
  updateUserAction,
} from "@/app/settings/users/actions";

type Role = "admin" | "staff";

export type UserRow = {
  userId: number;
  email: string;
  name: string | null;
  role: Role;
  /** Whether this person's membership in the CURRENT clinic is active. */
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: number | null;
  createdAt: number;
  /** A live (unaccepted) email invite is outstanding for this person. */
  invitePending: boolean;
};

export function UsersManager({
  users,
  currentUserId,
}: {
  users: UserRow[];
  currentUserId: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {users.map((u) => (
        <UserRow key={u.userId} user={u} isMe={u.userId === currentUserId} />
      ))}
      <NewUserButton />
    </div>
  );
}

function UserRow({
  user,
  isMe,
}: {
  user: UserRow;
  isMe: boolean;
}) {
  return (
    <Card style={{ display: "flex", alignItems: "center", gap: 16, padding: 18 }}>
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: "var(--radius)",
          background: "var(--surface-2)",
          border: "1px solid var(--hairline)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-primary)",
          fontSize: 14,
          fontWeight: 500,
          flexShrink: 0,
        }}
      >
        {(user.name?.[0] ?? user.email[0]).toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span
            style={{
              color: "var(--text-primary)",
              fontWeight: 500,
              fontSize: 15,
            }}
          >
            {user.name || user.email}
          </span>
          <Badge tone={user.role === "admin" ? "amber" : "neutral"}>
            {user.role}
          </Badge>
          {!user.isActive && <Badge tone="red">No access</Badge>}
          {user.invitePending ? (
            <Badge tone="amber">Invite pending</Badge>
          ) : (
            user.mustChangePassword && (
              <Badge tone="amber">Password reset pending</Badge>
            )
          )}
          {isMe && <Badge tone="green">You</Badge>}
        </div>
        <div
          style={{
            color: "var(--text-tertiary)",
            fontSize: 12,
            marginTop: 4,
          }}
        >
          {user.email}
          {user.lastLoginAt
            ? ` · last sign-in ${new Date(user.lastLoginAt).toLocaleString("en-IE", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              })}`
            : " · never signed in"}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {user.invitePending && <ResendInviteButton user={user} />}
        <ResetPasswordDialog user={user} />
        <EditUserDialog user={user} isMe={isMe} />
        <RemoveMemberButton user={user} disabled={isMe} />
      </div>
    </Card>
  );
}

function ResendInviteButton({ user }: { user: UserRow }) {
  const [pending, start] = useTransition();
  function resend() {
    start(async () => {
      const res = await resendInviteAction(user.userId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      // Email isn't set up (or the send failed): offer the link to copy & share
      // instead of a dead end.
      if (res.emailSent === false && res.inviteLink) {
        const link = res.inviteLink;
        toast.warning("Email isn't set up — copy the invite link to share.", {
          duration: 12000,
          action: {
            label: "Copy link",
            onClick: () =>
              navigator.clipboard.writeText(link).then(
                () => toast.success("Invite link copied."),
                () => toast.error("Couldn't copy — try again."),
              ),
          },
        });
        return;
      }
      toast.success(`Invite re-sent to ${user.email}`);
    });
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      title="Resend invite email"
      onClick={resend}
      disabled={pending}
    >
      <Mail size={14} strokeWidth={1.75} />
    </Button>
  );
}

function NewUserButton() {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [password, setPassword] = useState("");
  // "invite" emails a set-password link; "password" sets one to hand over.
  const [mode, setMode] = useState<"invite" | "password">("invite");
  // null = not yet checked; otherwise the lookup result for the typed email.
  const [lookup, setLookup] = useState<
    { exists: boolean; alreadyMember: boolean; name: string | null } | null
  >(null);
  const [checking, setChecking] = useState(false);
  // Set after an invite is created but its email couldn't be sent — the dialog
  // then shows this link for the admin to share manually instead of the form.
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  function reset() {
    setEmail("");
    setName("");
    setRole("staff");
    setPassword("");
    setMode("invite");
    setLookup(null);
    setInviteLink(null);
  }

  async function copyLink() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast.success("Invite link copied.");
    } catch {
      toast.error("Couldn't copy — select the link and copy it manually.");
    }
  }

  async function checkEmail() {
    const e = email.trim();
    if (!e) {
      setLookup(null);
      return;
    }
    setChecking(true);
    const res = await lookupIdentityAction(e);
    setChecking(false);
    if (res.ok) {
      setLookup({ exists: res.exists, alreadyMember: res.alreadyMember, name: res.name });
    } else {
      setLookup(null);
    }
  }

  const isNew = lookup !== null && !lookup.exists;
  const alreadyMember = lookup?.alreadyMember ?? false;
  const inviteMode = isNew && mode === "invite";

  function submit() {
    start(async () => {
      const res = await createUserAction({
        email,
        role,
        name: isNew ? name : undefined,
        password: isNew && mode === "password" ? password : undefined,
        mode: isNew ? mode : undefined,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      // Invite created but email couldn't go out → keep the dialog open and show
      // the link to share manually, and warn (not a green success) so it's clear.
      if (res.emailSent === false && res.inviteLink) {
        toast.warning("Account created — but email isn't set up, so share the invite link.");
        setInviteLink(res.inviteLink);
        return;
      }
      toast.success(res.note ?? (isNew ? "User created and added" : "User added to clinic"));
      setOpen(false);
      reset();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" style={{ alignSelf: "flex-start" }}>
          <Plus size={14} strokeWidth={2} />
          Add user
        </Button>
      </DialogTrigger>
      <DialogContent title={inviteLink ? "Share this invite link" : "Add user to this clinic"}>
        {inviteLink ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.55 }}>
              The account was created, but email isn&apos;t set up for this business yet, so the invite
              couldn&apos;t be sent. Copy this link and send it to them (WhatsApp, text, etc.) — it lets
              them set their own password. It expires in 7 days.
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Input
                readOnly
                value={inviteLink}
                onFocus={(e) => e.currentTarget.select()}
                style={{ flex: 1 }}
              />
              <Button variant="secondary" onClick={copyLink}>
                Copy
              </Button>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-tertiary)" }}>
              Set up email in Settings → Email to send (and re-send) invites automatically.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
              <Button
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                Done
              </Button>
            </div>
          </div>
        ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <Label htmlFor="new-email">Email</Label>
            <Input
              id="new-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setLookup(null);
              }}
              onBlur={checkEmail}
              autoFocus
              disabled={pending}
            />
            <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 6 }}>
              {checking
                ? "Checking…"
                : alreadyMember
                  ? "This person is already in this clinic."
                  : lookup?.exists
                    ? `Existing user${lookup.name ? ` (${lookup.name})` : ""} — they'll be added to this clinic with the role below.`
                    : isNew
                      ? "New email — invite them to set their own password, or set one manually."
                      : "Enter the person's email."}
            </div>
          </div>

          {isNew && (
            <>
              <div>
                <Label htmlFor="new-name">Name {mode === "invite" ? "(optional)" : ""}</Label>
                <Input
                  id="new-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={mode === "invite" ? "They can set this themselves" : ""}
                  disabled={pending}
                />
              </div>

              {/* Invite vs manual-password toggle */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <ModeRadio
                  checked={mode === "invite"}
                  onChange={() => setMode("invite")}
                  disabled={pending}
                  title="Email an invite"
                  desc="They get an email (from ClientFlow) with a link to set their own password."
                />
                <ModeRadio
                  checked={mode === "password"}
                  onChange={() => setMode("password")}
                  disabled={pending}
                  title="Set a password manually"
                  desc="You choose a temporary password to hand over."
                />
              </div>

              {mode === "password" && (
                <div>
                  <Label htmlFor="new-password">Temporary password</Label>
                  <Input
                    id="new-password"
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    disabled={pending}
                  />
                  <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 6 }}>
                    They&apos;ll be required to change this on first sign-in.
                  </div>
                </div>
              )}
            </>
          )}

          <div>
            <Label htmlFor="new-role">Role in this clinic</Label>
            <RoleSelect value={role} onChange={setRole} disabled={pending} />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <DialogClose asChild>
              <Button variant="ghost" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={submit} disabled={pending || alreadyMember || !email.trim()}>
              {pending
                ? "Adding…"
                : !isNew
                  ? "Add to clinic"
                  : inviteMode
                    ? "Send invite"
                    : "Create & add"}
            </Button>
          </div>
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ModeRadio({
  checked,
  onChange,
  disabled,
  title,
  desc,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  title: string;
  desc: string;
}) {
  return (
    <label
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: "10px 12px",
        border: `1px solid ${checked ? "var(--accent)" : "var(--hairline)"}`,
        borderRadius: "var(--radius)",
        cursor: disabled ? "default" : "pointer",
        background: checked ? "var(--surface-2)" : "transparent",
      }}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        style={{ marginTop: 2 }}
      />
      <span>
        <span style={{ display: "block", color: "var(--text-primary)", fontSize: 14, fontWeight: 500 }}>
          {title}
        </span>
        <span style={{ display: "block", color: "var(--text-tertiary)", fontSize: 12, marginTop: 2 }}>
          {desc}
        </span>
      </span>
    </label>
  );
}

function EditUserDialog({ user, isMe }: { user: UserRow; isMe: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [email, setEmail] = useState(user.email);
  const [emailError, setEmailError] = useState<string | undefined>();
  const [role, setRole] = useState<Role>(user.role);
  const [isActive, setIsActive] = useState(user.isActive);

  function submit() {
    setEmailError(undefined);
    start(async () => {
      const nextEmail = email.trim();
      const emailChanged = nextEmail !== user.email;
      if (emailChanged) {
        const emailRes = await updateMemberEmailAction(user.userId, nextEmail);
        if (!emailRes.ok) {
          setEmailError(emailRes.error);
          return; // leave the modal open — role/active aren't saved either
        }
      }
      const res = await updateUserAction(user.userId, { role, isActive });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(emailChanged ? "Membership and login email updated" : "Membership updated");
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setEmail(user.email);
          setEmailError(undefined);
          setRole(user.role);
          setIsActive(user.isActive);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Edit">
          <Pencil size={14} strokeWidth={1.75} />
        </Button>
      </DialogTrigger>
      <DialogContent title="Edit membership">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <Label htmlFor={`edit-email-${user.userId}`}>Login email</Label>
            <Input
              id={`edit-email-${user.userId}`}
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError(undefined);
              }}
              disabled={pending}
            />
            <FieldError message={emailError} />
            <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 6 }}>
              This is their sign-in email. Changing it updates how they log in
              to <strong>all</strong> of their accounts, not just this one.
            </div>
          </div>
          <div>
            <Label htmlFor={`edit-name-${user.userId}`}>Name</Label>
            <Input
              id={`edit-name-${user.userId}`}
              value={user.name ?? ""}
              disabled
              readOnly
            />
            <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 6 }}>
              Name is part of the person&apos;s account and shared across
              their clinics — managed on their profile, not here.
            </div>
          </div>
          <div>
            <Label htmlFor={`edit-role-${user.userId}`}>Role in this clinic</Label>
            <RoleSelect value={role} onChange={setRole} disabled={pending} />
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "var(--text-secondary)",
              fontSize: 14,
            }}
          >
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              disabled={pending}
            />
            Active in this clinic
          </label>
          {isMe && (
            <div
              style={{
                background: "rgba(217, 119, 6, 0.08)",
                border: "1px solid rgba(217, 119, 6, 0.3)",
                color: "#92400e",
                fontSize: 12,
                padding: "8px 12px",
                borderRadius: "var(--radius)",
              }}
            >
              You are editing your own membership. Demoting or deactivating
              yourself is blocked if you are the only admin of this clinic.
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <DialogClose asChild>
              <Button variant="ghost" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={submit} disabled={pending || !email.trim()}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user }: { user: UserRow }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [password, setPassword] = useState("");
  const [mustChange, setMustChange] = useState(true);

  function submit() {
    start(async () => {
      const res = await resetPasswordAction(user.userId, { password, mustChange });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Password reset");
      setOpen(false);
      setPassword("");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Reset password">
          <KeyRound size={14} strokeWidth={1.75} />
        </Button>
      </DialogTrigger>
      <DialogContent title="Reset password" description={user.email}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <Label htmlFor={`reset-${user.userId}`}>New password</Label>
            <Input
              id={`reset-${user.userId}`}
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              disabled={pending}
              autoFocus
            />
            <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 6 }}>
              This changes the person&apos;s sign-in password across all their
              clinics.
            </div>
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "var(--text-secondary)",
              fontSize: 14,
            }}
          >
            <input
              type="checkbox"
              checked={mustChange}
              onChange={(e) => setMustChange(e.target.checked)}
              disabled={pending}
            />
            Require user to change on next sign-in
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <DialogClose asChild>
              <Button variant="ghost" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Saving…" : "Reset password"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RemoveMemberButton({
  user,
  disabled,
}: {
  user: UserRow;
  disabled: boolean;
}) {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);

  function confirm() {
    start(async () => {
      const res = await removeMembershipAction(user.userId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Removed from clinic");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title={disabled ? "You can't remove yourself from a clinic" : "Remove from clinic"}
          disabled={disabled}
          style={disabled ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
        >
          <UserMinus size={14} strokeWidth={1.75} />
        </Button>
      </DialogTrigger>
      <DialogContent title="Remove from clinic" description={user.email} width={420}>
        <p style={{ color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.5 }}>
          This revokes <strong>{user.name || user.email}</strong>&apos;s access to
          this clinic and signs them out of it. Their account and any other clinics
          they belong to are unaffected — you can add them back later.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <DialogClose asChild>
            <Button variant="ghost" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={confirm} disabled={pending}>
            {pending ? "Removing…" : "Remove"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RoleSelect({
  value,
  onChange,
  disabled,
}: {
  value: Role;
  onChange: (v: Role) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Role)}
      disabled={disabled}
      style={{
        width: "100%",
        background: "var(--bg)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        padding: "10px 14px",
        color: "var(--text-primary)",
        fontSize: 14,
        outline: "none",
        fontFamily: "inherit",
      }}
    >
      <option value="staff">Staff — day-to-day operations</option>
      <option value="admin">Admin — full access incl. settings/reports</option>
    </select>
  );
}
