"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Minus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/Dialog";
import { Input, Label } from "@/components/ui/Input";
import type { SetupAction, SetupGroup, SetupStepStatus, SetupSummary } from "@/lib/setup/steps";
import type { VenueType, SchedulingMode } from "@/lib/settings";
import {
  ackVenueAction,
  dismissSetupAction,
  saveBusinessEssentialsAction,
  skipStepAction,
} from "@/app/setup/actions";

export interface BusinessEssentialsDefaults {
  businessName: string;
  tagline: string;
  location: string;
  phone: string;
  website: string;
}

interface Props {
  summary: SetupSummary;
  isAdmin: boolean;
  venue: VenueType;
  scheduling: SchedulingMode;
  businessDefaults: BusinessEssentialsDefaults;
}

const GROUP_ORDER: SetupGroup[] = ["foundation", "channels", "data"];
const GROUP_LABELS: Record<SetupGroup, string> = {
  foundation: "The basics",
  channels: "Channels",
  data: "Your data & team",
};

// A couple of steps carry a secondary link to an alternate/manual path —
// keyed by step id since the generic "or set up manually" fallback doesn't
// fit every case (e.g. branding's secondary is the separate theme screen).
const SECONDARY_LABELS: Record<string, string> = {
  branding: "or set your theme",
  clients: "or add one by hand",
};

export function SetupChecklist({ summary, isAdmin, venue, scheduling, businessDefaults }: Props) {
  const router = useRouter();
  const [dismissing, startDismiss] = useTransition();

  function dismiss() {
    startDismiss(async () => {
      const res = await dismissSetupAction();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.push("/dashboard");
    });
  }

  const next = summary.steps.find((s) => !s.done && !s.skipped) ?? null;
  const pct = summary.total ? Math.round((summary.resolved / summary.total) * 100) : 0;

  return (
    <div className="su-layout">
      <aside className="su-side">
        <div className="su-progress">
          <div className="su-progress-num">
            <span>{summary.resolved}</span>
            <span className="su-progress-of">of {summary.total} done</span>
          </div>
          <div className="su-segments" aria-hidden>
            {summary.steps.map((s) => (
              <span key={s.id} className={s.done ? "is-done" : s.skipped ? "is-skipped" : ""} />
            ))}
          </div>
          <p className="su-progress-note">
            {summary.requiredDone}/{summary.requiredTotal} essentials, {pct}% overall
          </p>
          {next ? (
            <div className="su-next">
              <span className="su-next-label">Next up</span>
              <span className="su-next-title">{next.title}</span>
              <a href={`#step-${next.id}`} className="su-next-go">
                Go to step <ArrowRight size={14} aria-hidden />
              </a>
            </div>
          ) : isAdmin ? (
            <div className="su-next">
              <span className="su-next-title">Everything is set up.</span>
              <Button size="sm" onClick={dismiss} loading={dismissing}>
                Hide this guide
              </Button>
            </div>
          ) : null}
        </div>
        <nav className="su-groupnav" aria-label="Sections">
          {GROUP_ORDER.map((group) => {
            const rows = summary.steps.filter((s) => s.group === group);
            if (rows.length === 0) return null;
            const doneCount = rows.filter((r) => r.done || r.skipped).length;
            return (
              <a key={group} href={`#group-${group}`} className="su-groupnav-link">
                <span>{GROUP_LABELS[group]}</span>
                <span className={doneCount === rows.length ? "su-count is-full" : "su-count"}>
                  {doneCount}/{rows.length}
                </span>
              </a>
            );
          })}
        </nav>
      </aside>

      <div className="su-main">
        {GROUP_ORDER.map((group) => {
          const rows = summary.steps.filter((s) => s.group === group);
          if (rows.length === 0) return null;
          const doneCount = rows.filter((r) => r.done || r.skipped).length;
          return (
            <section key={group} id={`group-${group}`} className="su-group" aria-labelledby={`group-${group}-title`}>
              <header className="su-group-head">
                <h2 id={`group-${group}-title`}>{GROUP_LABELS[group]}</h2>
                <span className="su-count">{doneCount} of {rows.length}</span>
              </header>
              <ol className="su-list">
                {rows.map((step) => (
                  <StepRow
                    key={step.id}
                    step={step}
                    isNext={next?.id === step.id}
                    isAdmin={isAdmin}
                    venue={venue}
                    scheduling={scheduling}
                    businessDefaults={businessDefaults}
                  />
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function StepRow({
  step,
  isNext,
  isAdmin,
  venue,
  scheduling,
  businessDefaults,
}: {
  step: SetupStepStatus;
  isNext: boolean;
  isAdmin: boolean;
  venue: VenueType;
  scheduling: SchedulingMode;
  businessDefaults: BusinessEssentialsDefaults;
}) {
  const showSkip = isAdmin && step.optional && !step.done && !step.skipped;
  const state = step.done ? "is-done" : step.skipped ? "is-skipped" : "is-todo";
  const wide = step.action.kind === "ack-venue" && !step.done;
  return (
    <li id={`step-${step.id}`} className={`su-row ${state}${isNext ? " is-next" : ""}${wide ? " is-wide" : ""}`}>
      <StatusMark step={step} />
      <div className="su-row-text">
        <div className="su-row-title">
          {step.title}
          {step.optional && !step.done ? <span className="su-tag">Optional</span> : null}
          {step.skipped ? <span className="su-tag">Skipped</span> : null}
        </div>
        {!step.done && <p className="su-row-blurb">{step.blurb}</p>}
        {isAdmin && step.agencyNote && !step.done && <p className="su-row-note">{step.agencyNote}</p>}
      </div>
      {isAdmin && (
        <div className="su-row-actions">
          {showSkip && <SkipButton id={step.id} />}
          <StepActions step={step} venue={venue} scheduling={scheduling} businessDefaults={businessDefaults} />
        </div>
      )}
    </li>
  );
}

function StatusMark({ step }: { step: SetupStepStatus }) {
  if (step.done) {
    return (
      <span className="su-mark is-done" aria-label="Done">
        <Check size={12} strokeWidth={3} />
      </span>
    );
  }
  if (step.skipped) {
    return (
      <span className="su-mark is-skipped" aria-label="Skipped">
        <Minus size={12} strokeWidth={3} />
      </span>
    );
  }
  return <span className="su-mark" aria-label="To do" />;
}

function StepActions({
  step,
  venue,
  scheduling,
  businessDefaults,
}: {
  step: SetupStepStatus;
  venue: VenueType;
  scheduling: SchedulingMode;
  businessDefaults: BusinessEssentialsDefaults;
}) {
  const { action } = step;
  if (action.kind === "link") {
    return <LinkAction step={step} action={action} />;
  }
  if (action.kind === "inline-business") {
    return <InlineBusinessAction defaults={businessDefaults} />;
  }
  return <AckVenueAction venue={venue} scheduling={scheduling} />;
}

function LinkAction({
  step,
  action,
}: {
  step: SetupStepStatus;
  action: Extract<SetupAction, { kind: "link" }>;
}) {
  if (step.done) {
    return (
      <Link href={action.href}>
        <Button variant="ghost" size="sm">
          View
        </Button>
      </Link>
    );
  }
  return (
    <>
      <Link href={action.href}>
        <Button size="sm">Set up</Button>
      </Link>
      {action.secondaryHref && (
        <Link href={action.secondaryHref}>
          <Button variant="ghost" size="sm">
            {SECONDARY_LABELS[step.id] ?? "or set up manually"}
          </Button>
        </Link>
      )}
    </>
  );
}

function InlineBusinessAction({ defaults }: { defaults: BusinessEssentialsDefaults }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startSave] = useTransition();
  const [businessName, setBusinessName] = useState(defaults.businessName);
  const [tagline, setTagline] = useState(defaults.tagline);
  const [location, setLocation] = useState(defaults.location);
  const [phone, setPhone] = useState(defaults.phone);
  const [website, setWebsite] = useState(defaults.website);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // Reload from the latest saved values every time it's (re)opened.
      setBusinessName(defaults.businessName);
      setTagline(defaults.tagline);
      setLocation(defaults.location);
      setPhone(defaults.phone);
      setWebsite(defaults.website);
    }
  }

  function submit() {
    startSave(async () => {
      const res = await saveBusinessEssentialsAction({
        businessName,
        tagline,
        location,
        phone,
        website,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Business essentials saved");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">Fill in</Button>
      </DialogTrigger>
      <DialogContent
        title="Business essentials"
        description="Shown across the app and used in AI-generated content."
      >
        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <Label htmlFor="setup-business-name" srOnly>Business name</Label>
            <Input
              id="setup-business-name"
              placeholder="Business name"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              disabled={pending}
              autoFocus
              required
            />
          </div>
          <div>
            <Label htmlFor="setup-business-tagline" srOnly>Tagline</Label>
            <Input
              id="setup-business-tagline"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              disabled={pending}
              placeholder="Tagline"
            />
          </div>
          <div>
            <Label htmlFor="setup-business-location" srOnly>Location</Label>
            <Input
              id="setup-business-location"
              placeholder="Location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              disabled={pending}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <Label htmlFor="setup-business-phone" srOnly>Phone</Label>
              <Input
                id="setup-business-phone"
                placeholder="Phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={pending}
              />
            </div>
            <div>
              <Label htmlFor="setup-business-website" srOnly>Website</Label>
              <Input
                id="setup-business-website"
                placeholder="Website"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                disabled={pending}
              />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button onClick={submit} disabled={!businessName.trim()} loading={pending}>
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const VENUE_OPTIONS: { value: VenueType; label: string }[] = [
  { value: "clinic", label: "Clinic" },
  { value: "gym", label: "Gym" },
];
const SCHEDULING_OPTIONS: { value: SchedulingMode; label: string }[] = [
  { value: "appointments", label: "Appointments" },
  { value: "timetable", label: "Timetable" },
];

function AckVenueAction({ venue, scheduling }: { venue: VenueType; scheduling: SchedulingMode }) {
  const router = useRouter();
  const [v, setV] = useState<VenueType>(venue);
  const [s, setS] = useState<SchedulingMode>(scheduling);
  const [pending, startConfirm] = useTransition();

  function confirm() {
    startConfirm(async () => {
      const res = await ackVenueAction({ venue: v, scheduling: s });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <ToggleGroup value={v} onChange={setV} options={VENUE_OPTIONS} disabled={pending} />
      <ToggleGroup value={s} onChange={setS} options={SCHEDULING_OPTIONS} disabled={pending} />
      <Button size="sm" onClick={confirm} loading={pending}>
        Confirm
      </Button>
    </div>
  );
}

function ToggleGroup<T extends string>({
  value,
  onChange,
  options,
  disabled,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        overflow: "hidden",
      }}
    >
      {options.map((o, idx) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.value)}
            style={{
              padding: "6px 12px",
              fontSize: 12.5,
              fontWeight: 500,
              fontFamily: "inherit",
              border: "none",
              borderRight: idx === options.length - 1 ? "none" : "1px solid var(--hairline)",
              cursor: disabled ? "default" : "pointer",
              background: active ? "var(--surface-2)" : "transparent",
              color: active ? "var(--text-primary)" : "var(--text-tertiary)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function SkipButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startSkip] = useTransition();

  function skip() {
    startSkip(async () => {
      const res = await skipStepAction(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Button variant="ghost" size="sm" onClick={skip} loading={pending}>
      Skip
    </Button>
  );
}
