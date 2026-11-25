"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { ApplyResult, DryRunData, DryRunResponse, ImportResponse } from "@/lib/ghlImport/types";

import { DryRunView, ResultView, UploadStep } from "./views";

const DAY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" });
const dayOf = (ms: number) => DAY_FMT.format(new Date(ms));

export function GhlImportWizard() {
  const confirm = useConfirm();
  const today = dayOf(Date.now());
  const [contacts, setContacts] = useState<File | null>(null);
  const [opportunities, setOpportunities] = useState<File | null>(null);
  const [exportDay, setExportDay] = useState(today);
  const [dayTouched, setDayTouched] = useState(false);
  const [assignees, setAssignees] = useState<Record<string, number | null>>({});
  const [data, setData] = useState<DryRunData | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post<T>(mode: "dry-run" | "import", picks: Record<string, number | null>): Promise<T> {
    const fd = new FormData();
    fd.set("mode", mode);
    if (contacts) fd.set("contacts", contacts);
    if (opportunities) fd.set("opportunities", opportunities);
    fd.set("exportDay", exportDay);
    fd.set("assignees", JSON.stringify(picks));
    const res = await fetch("/api/import/gohighlevel", { method: "POST", body: fd });
    const json = (await res.json().catch(() => null)) as ({ ok: boolean; error?: string } & T) | null;
    if (!json || !json.ok) throw new Error(json?.error ?? "Something went wrong. Try again.");
    return json;
  }

  async function check(picks = assignees) {
    setBusy(true);
    setError(null);
    try {
      const res = await post<Extract<DryRunResponse, { ok: true }>>("dry-run", picks);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!data) return;
    const n = data.totals.people - data.totals.alreadyImported - data.totals.skipped - data.totals.unchanged;
    const yes = await confirm({
      title: `Import ${n.toLocaleString("en-IE")} people?`,
      body: "They go on the board and into follow-ups as the list shows. The import sends nothing itself. Running it again with the same files changes nothing.",
      confirmLabel: "Import",
    });
    if (!yes) return;
    setBusy(true);
    try {
      const res = await post<Extract<ImportResponse, { ok: true }>>("import", assignees);
      setResult(res.result);
      toast.success("Imported from GoHighLevel.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The import failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <ResultView
        result={result}
        onAgain={() => {
          setResult(null);
          setData(null);
        }}
      />
    );
  }
  if (data) {
    return (
      <DryRunView
        data={data}
        busy={busy}
        onBack={() => setData(null)}
        onImport={runImport}
        onAssignee={(name, userId) => {
          const picks = { ...assignees, [name]: userId };
          setAssignees(picks);
          void check(picks);
        }}
      />
    );
  }
  return (
    <UploadStep
      contacts={contacts}
      opportunities={opportunities}
      exportDay={exportDay}
      today={today}
      busy={busy}
      error={error}
      onContacts={setContacts}
      onOpportunities={(f) => {
        setOpportunities(f);
        // The day the file was downloaded is the export day, unless the operator has set it.
        if (f && !dayTouched) {
          const d = dayOf(f.lastModified);
          if (d <= today) setExportDay(d);
        }
      }}
      onExportDay={(d) => {
        setDayTouched(true);
        setExportDay(d);
      }}
      onCheck={() => void check()}
    />
  );
}
