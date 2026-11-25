"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Download, FileSearch, FileUp, Search, Upload, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { dryRunCsv, type DryRunRow } from "@/lib/ghlImport/plan";
import type { ApplyResult, AssigneeRow, DryRunData } from "@/lib/ghlImport/types";

import styles from "./ghlImport.module.css";

const DUE = new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const fmtDue = (ms: number) => DUE.format(new Date(ms));
const num = (n: number) => n.toLocaleString("en-IE");
const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", email: "Email" };
const PAGE = 50;

function FileBox(props: { label: string; hint: string; file: File | null; onFile: (f: File | null) => void; id: string }) {
  return (
    <label className={styles.drop} htmlFor={props.id}>
      <input id={props.id} type="file" accept=".csv,text/csv" onChange={(e) => props.onFile(e.target.files?.[0] ?? null)} />
      <span className={styles.dropLabel}>
        <FileUp size={16} aria-hidden /> {props.label}
      </span>
      {props.file ? (
        <span className={styles.dropChosen}>
          {props.file.name}, {Math.max(1, Math.round(props.file.size / 1024))} KB
        </span>
      ) : (
        <span className={styles.dropHint}>{props.hint}</span>
      )}
    </label>
  );
}

export function UploadStep(props: {
  contacts: File | null;
  opportunities: File | null;
  exportDay: string;
  today: string;
  busy: boolean;
  error: string | null;
  onContacts: (f: File | null) => void;
  onOpportunities: (f: File | null) => void;
  onExportDay: (day: string) => void;
  onCheck: () => void;
}) {
  return (
    <section className={styles.card} aria-labelledby="ghl-upload">
      <h2 className={styles.cardTitle} id="ghl-upload">
        <Upload size={16} aria-hidden /> Upload your exports
      </h2>
      <p className={styles.note}>In GoHighLevel, export Contacts (all columns) and Opportunities as CSV files. The contacts file is needed; the opportunities file says where each lead was.</p>
      <div className={styles.files}>
        <FileBox id="ghl-contacts" label="Contacts export" hint="Required. A .csv file." file={props.contacts} onFile={props.onContacts} />
        <FileBox id="ghl-opportunities" label="Opportunities export" hint="Optional. A .csv file." file={props.opportunities} onFile={props.onOpportunities} />
      </div>
      <div className={styles.dateRow}>
        <Label htmlFor="ghl-export-day">Export date</Label>
        <Input id="ghl-export-day" type="date" value={props.exportDay} max={props.today} onChange={(e) => props.onExportDay(e.target.value)} />
        <p className={styles.note}>The day you downloaded the files. Days in each stage are counted back from it.</p>
      </div>
      {props.error && <p className={styles.error} role="alert">{props.error}</p>}
      <div className={styles.actions}>
        <Button onClick={props.onCheck} loading={props.busy} disabled={!props.contacts || !props.exportDay}>
          <FileSearch size={15} aria-hidden /> Check what will happen
        </Button>
      </div>
      <p className={styles.note}>Nothing is imported or sent until you press Import on the next screen.</p>
    </section>
  );
}

function Tiles({ items }: { items: [string, number][] }) {
  return (
    <div className={styles.tiles}>
      {items.map(([label, value]) => (
        <div className={styles.tile} key={label}>
          <span className={styles.tileLabel}>{label}</span>
          <span className={styles.tileValue}>{num(value)}</span>
        </div>
      ))}
    </div>
  );
}

function Assignees(props: { rows: AssigneeRow[]; staff: DryRunData["staff"]; defaultName: string | null; busy: boolean; onChange: (ghlName: string, userId: number | null) => void }) {
  if (props.rows.length === 0) return null;
  return (
    <section className={styles.card} aria-labelledby="ghl-assignees">
      <h2 className={styles.cardTitle} id="ghl-assignees">
        <UserRound size={16} aria-hidden /> Who their leads go to
      </h2>
      <p className={styles.note}>Each GoHighLevel user, and the person here who takes over their leads.</p>
      <div>
        {props.rows.map((a) => (
          <div className={styles.assignee} key={a.ghlName}>
            <span>
              {a.ghlName} <span className={styles.sub}>{num(a.people)} people</span>
            </span>
            <select
              className={styles.select}
              aria-label={`Leads assigned to ${a.ghlName} in GoHighLevel`}
              value={a.userId == null ? "" : String(a.userId)}
              disabled={props.busy}
              onChange={(e) => props.onChange(a.ghlName, e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">{props.defaultName ? `The default (${props.defaultName})` : "Nobody"}</option>
              {props.staff.map((s) => (
                <option key={s.userId} value={s.userId}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </section>
  );
}

function matches(r: DryRunRow, q: string): boolean {
  if (!q) return true;
  return [r.name, r.email, r.phone, r.fromStage, r.to, r.flow ?? "", r.note].some((v) => v.toLowerCase().includes(q));
}

export function DryRunView(props: {
  data: DryRunData;
  busy: boolean;
  onAssignee: (ghlName: string, userId: number | null) => void;
  onBack: () => void;
  onImport: () => void;
}) {
  const { totals: t, rows } = props.data;
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => rows.filter((r) => matches(r, q)), [rows, q]);
  const toImport = t.people - t.alreadyImported - t.skipped - t.unchanged;

  function download() {
    const blob = new Blob([dryRunCsv(filtered, fmtDue)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gohighlevel-import-${props.data.exportDay}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={styles.stack}>
      <Tiles
        items={[
          ["People in the files", t.people],
          ["On the lead board", t.leads],
          ["Clients", t.clients],
          ["Email contacts only", t.contactsOnly],
          ["Added to email contacts", t.emailContactsAdded],
          ["Do not contact", t.doNotContact],
          ["Matched to someone here", t.duplicates],
          ["Messages in the next 7 days", t.messagesNext7Days],
        ]}
      />
      {t.alreadyImported > 0 && <p className={styles.note}>{num(t.alreadyImported)} people were imported before. Nothing changes for them.</p>}
      <div className={styles.lists}>
        <section className={styles.card} aria-labelledby="ghl-columns">
          <h2 className={styles.cardTitle} id="ghl-columns">Where leads go</h2>
          <ul className={styles.list}>
            {t.columns.map((c) => (
              <li key={c.name}>
                <span>
                  {c.name}
                  {t.newColumns.includes(c.name) && (
                    <>
                      {" "}
                      <Badge tone="info">New column</Badge>
                    </>
                  )}
                </span>
                <b>{num(c.count)}</b>
              </li>
            ))}
          </ul>
        </section>
        <section className={styles.card} aria-labelledby="ghl-flows">
          <h2 className={styles.cardTitle} id="ghl-flows">Follow-ups</h2>
          {t.flows.length === 0 ? (
            <p className={styles.note}>Nobody is placed in a follow-up.</p>
          ) : (
            <ul className={styles.list}>
              {t.flows.map((f) => (
                <li key={f.key}>
                  <span>
                    {f.label}
                    {!f.enabled && (
                      <>
                        {" "}
                        <Badge tone="warning">Off</Badge>
                      </>
                    )}
                  </span>
                  <b>{num(f.people)}</b>
                </li>
              ))}
            </ul>
          )}
          {t.flows.some((f) => !f.enabled) && <p className={styles.note}>A follow-up that is off waits: its people start when you switch it on, and steps whose time passed are skipped.</p>}
          <p className={styles.note}>Steps GoHighLevel already sent are not sent again. A step whose time has passed is skipped, and nobody gets more than one message today. Messages are spread across your sending hours.</p>
        </section>
      </div>
      <Assignees rows={props.data.assignees} staff={props.data.staff} defaultName={props.data.defaultAssigneeName} busy={props.busy} onChange={props.onAssignee} />
      <section className={styles.card} aria-labelledby="ghl-people">
        <h2 className={styles.cardTitle} id="ghl-people">Everyone in the files</h2>
        <div className={styles.searchRow}>
          <div className={styles.search}>
            <Search size={15} aria-hidden />
            <Input
              aria-label="Search people"
              placeholder="Search by name, email, phone or stage"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShown(PAGE);
              }}
            />
          </div>
          <span className={styles.count}>{num(filtered.length)} people</span>
          <Button variant="outline" onClick={download}>
            <Download size={15} aria-hidden /> Download the list
          </Button>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>From</th>
                <th>Days</th>
                <th>Goes to</th>
                <th>Follow-up</th>
                <th>Next message</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, shown).map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className={styles.name}>{r.name}</span>
                    {r.email && <span className={styles.sub}>{r.email}</span>}
                    {r.doNotContact && <Badge tone="danger">Do not contact</Badge>}
                  </td>
                  <td data-label="From">{r.fromStage}</td>
                  <td data-label="Days">{r.days ?? ""}</td>
                  <td data-label="Goes to">{r.to}</td>
                  <td data-label="Follow-up">{r.flow ? `${r.flow}${r.flowOff ? " (off)" : ""}` : "None"}</td>
                  <td data-label="Next message">{r.nextAt != null ? `${CHANNEL[r.nextChannel ?? ""] ?? r.nextChannel}, ${fmtDue(r.nextAt)}` : "None"}</td>
                  <td data-label="Notes">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > shown && (
            <div className={styles.more}>
              <Button variant="secondary" onClick={() => setShown((s) => s + PAGE)}>
                Show {Math.min(PAGE, filtered.length - shown)} more
              </Button>
            </div>
          )}
        </div>
      </section>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={props.onBack} disabled={props.busy}>
          <ArrowLeft size={15} aria-hidden /> Back
        </Button>
        <Button onClick={props.onImport} loading={props.busy} disabled={toImport <= 0}>
          <Upload size={15} aria-hidden /> Import {num(Math.max(0, toImport))} people
        </Button>
      </div>
    </div>
  );
}

export function ResultView({ result, onAgain }: { result: ApplyResult; onAgain: () => void }) {
  return (
    <div className={styles.stack}>
      <section className={styles.card} aria-labelledby="ghl-done">
        <h2 className={styles.cardTitle} id="ghl-done">
          <CheckCircle2 size={16} aria-hidden /> Imported
        </h2>
        <p className={styles.note}>
          Nothing was sent. Follow-up messages go at their times while each follow-up is switched on. Email contacts added counts people with no opportunity; leads with marketing consent are on your email contacts too.
          {result.runsWaiting > 0 ? ` ${num(result.runsWaiting)} people wait for a follow-up that is off.` : ""}
          {result.holdingCreated ? " A Holding column was added to the board." : ""}
        </p>
      </section>
      <Tiles
        items={[
          ["New leads", result.leadsCreated],
          ["Leads updated", result.leadsUpdated],
          ["New clients", result.clientsCreated],
          ["Email contacts added", result.contactsAdded],
          ["Do not contact", result.doNotContact],
          ["In a follow-up", result.runsPlaced],
          ["Messages scheduled", result.messagesQueued],
          ["Already imported", result.alreadyImported],
        ]}
      />
      {result.failed > 0 && (
        <p className={styles.error} role="alert">
          {num(result.failed)} people could not be imported. Import again to retry them; everyone else stays as they are.
        </p>
      )}
      <div className={`${styles.actions} ${styles.actionsStart}`}>
        <a className="btn btn--primary btn--md" href="/leads">
          Open the leads board
        </a>
        <Button variant="secondary" onClick={onAgain}>
          Import more files
        </Button>
      </div>
    </div>
  );
}
