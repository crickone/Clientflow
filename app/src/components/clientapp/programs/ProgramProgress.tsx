// app/src/components/clientapp/programs/ProgramProgress.tsx
/**
 * A running program's progress: the path chart per lift (solid so far, dashed
 * planned) and the + sets logged. A server component: every lift's chart is
 * rendered here and LiftSwitch only shows one at a time.
 */
import type { ProgramProgressData } from "@/lib/programs/progressData";
import { LiftSwitch } from "./LiftSwitch";
import { PathChart, PkSection, QuietRow } from "./kit";

export function ProgramProgress({ data }: { data: ProgramProgressData }) {
  const { charts, rows } = data;
  const empty = data.plus ? "Your + sets show here after your first session." : "Your top sets show here after your first session.";
  return (
    <>
      {charts.length > 0 && (
        <PkSection label={data.kindLabel}>
          {charts.length === 1 && <b className="pk-chart-name">{charts[0].label}</b>}
          <LiftSwitch lifts={charts.map((c) => ({ lift: c.lift, label: c.label }))}>
            {charts.map((c) => (
              <PathChart key={c.lift} chart={c} totalWeeks={data.totalWeeks} unit={data.unit} kind={data.kind} />
            ))}
          </LiftSwitch>
          <span className="pk-small">{data.plannedNote}</span>
        </PkSection>
      )}
      <PkSection label={data.rowsTitle}>
        {rows.length === 0 ? (
          <QuietRow label={empty} />
        ) : (
          <ul className="pk-rows">
            {rows.map((r) => (
              <li key={`${r.at}-${r.lift}-${r.planned}-${r.got}`} className="pk-rows-item">
                <span className="pk-rows-what">
                  <span>{`Week ${r.week} · ${r.planned}`}</span>
                  <span className="pk-small">{r.lift}</span>
                </span>
                <b className="pk-rows-got">{r.got}</b>
              </li>
            ))}
          </ul>
        )}
      </PkSection>
    </>
  );
}
