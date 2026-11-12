// app/src/components/clientapp/programs/ProgramDetail.tsx
/**
 * The program page (direction B, story and phases): what the program is, its
 * shape, a typical week, what each phase is like, why it works, how the
 * weights move and every week in full. Server-renderable; the page does the
 * reading and the gates.
 */
import Link from "next/link";
import { ChevronDown, Pencil } from "lucide-react";

import { PhaseBar, Pills, PkCard, PkHeader, PkSection, StickyBar, Warn } from "@/components/clientapp/programs/kit";
import { weeksText, type ProgramContent } from "@/lib/programs/content";
import { lengthTag, sessionMinutes, typicalWeek, wholeProgram, type OutlineDay } from "@/lib/programs/outline";
import { howWeightsMove } from "@/lib/programs/progressionText";
import { FAMILY_LABEL, LEVEL_LABEL, LIFT_LABEL, type ProgramTemplate, type WeightUnit } from "@/lib/programs/types";

export type DetailAction = { kind: "start"; href: string } | { kind: "continue" } | { kind: "busy"; runningName: string };

/** How many exercises a typical-week day lists before "and N more". */
const DAY_LINES = 3;

function DayRow({ d, all }: { d: OutlineDay; all?: boolean }) {
  const lines = all ? d.lines : d.lines.slice(0, DAY_LINES);
  return (
    <div className="pk-day">
      <span className="pk-day-name">
        {d.name}
        {d.test ? ", test day" : ""}
      </span>
      {lines.map((l, i) => (
        <div key={i}>
          <div className="pk-line">
            <span>
              {l.name}
              {l.joined ? ", superset with the one above" : ""}
            </span>
            <span>{l.rx}</span>
          </div>
          {all && l.notes && <span className="pk-small">{l.notes}</span>}
        </div>
      ))}
      {!all && d.lines.length > DAY_LINES && <span className="pk-small">And {d.lines.length - DAY_LINES} more</span>}
    </div>
  );
}

export function ProgramDetail({
  template: t,
  content,
  memberBuilt,
  current,
  unit,
  stepKg,
  action,
  editHref,
}: {
  template: ProgramTemplate;
  content: ProgramContent;
  memberBuilt: boolean;
  /** The phase the member is in, when this is their running program. */
  current: number | null;
  unit: WeightUnit;
  stepKg: number;
  action: DetailAction;
  /** A member's own program: where to edit it. */
  editHref?: string;
}) {
  const length = lengthTag(t, content.repeats);
  const pills = [`${t.daysPerWeek} ${t.daysPerWeek === 1 ? "day" : "days"} a week`, length, `About ${sessionMinutes(t)} min`, ...(memberBuilt ? [] : [LEVEL_LABEL[t.level]])];
  const notes = content.phases.filter((p) => p.note.trim());
  return (
    <div className="pk">
      <PkHeader crumb={`${memberBuilt ? "Your program" : FAMILY_LABEL[t.family]} · ${length}`} title={t.name} lead={content.summary} byline={content.byline}>
        <Pills items={pills} />
        {editHref && (
          <Link href={editHref} className="pk-ghost">
            <Pencil size={16} aria-hidden /> Edit program
          </Link>
        )}
      </PkHeader>

      <PkSection label="The shape of it">
        <PhaseBar phases={content.phases} current={current} named />
        {content.repeats && <span className="pk-small">{t.weeks.length === 1 ? "One week that repeats." : `These ${t.weeks.length} weeks repeat.`}</span>}
      </PkSection>

      <PkSection label="A typical week">
        {typicalWeek(t).map((d, i) => (
          <DayRow key={i} d={d} />
        ))}
      </PkSection>

      {notes.length > 0 && (
        <PkSection label="What to expect">
          {notes.map((p) => {
            const weeks = weeksText(p.fromWeek, p.toWeek);
            return (
              <div key={`${p.fromWeek}-${p.name}`} className="pk-note">
                <b>{p.name === weeks ? weeks : `${p.name}, ${weeks.toLowerCase()}`}</b>
                <span className="pk-muted">{p.note}</span>
              </div>
            );
          })}
        </PkSection>
      )}

      {content.whyItWorks && (
        <PkSection label="Why it works">
          <p className="pk-muted">{content.whyItWorks}</p>
        </PkSection>
      )}

      <PkSection label="How your weights move">
        <ul className="pk-list">
          {howWeightsMove(t, unit, stepKg).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </PkSection>

      <PkSection label="The whole program">
        {wholeProgram(t).map((w) => (
          <details key={w.title} className="pk-fold">
            <summary>
              <span>{w.title}</span>
              <ChevronDown size={18} aria-hidden />
            </summary>
            <div className="pk-fold-body">
              {w.days.map((d, i) => (
                <DayRow key={i} d={d} all />
              ))}
            </div>
          </details>
        ))}
        <span className="pk-small">Your weights are worked out from your maxes when you start.</span>
      </PkSection>

      {t.warning && <Warn>{t.warning}</Warn>}
      {t.lifts.length > 0 && action.kind === "start" && <span className="pk-small">You need a max for: {t.lifts.map((l) => LIFT_LABEL[l].toLowerCase()).join(", ")}.</span>}

      {action.kind === "busy" ? (
        <PkCard>
          <span className="pk-muted">You&rsquo;re running {action.runningName}. End it on My program before you start another.</span>
          <Link href="/app/programs/mine" className="pk-ghost">
            Go to My program
          </Link>
        </PkCard>
      ) : (
        <StickyBar>
          <Link href={action.kind === "continue" ? "/app/programs/mine" : action.href} className="pk-cta">
            {action.kind === "continue" ? "Continue" : "Start this program"}
          </Link>
        </StickyBar>
      )}
    </div>
  );
}
