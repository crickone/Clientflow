"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, FileUp, Link2, Trash2, Unplug } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Input, Label, PasswordInput } from "@/components/ui/Input";
import { formatMetric, HEADLINE_METRICS } from "@/lib/inbody/metrics";
import type { ScanView } from "@/lib/inbody/scans";
import {
  assignScanAction,
  deleteScanAction,
  disconnectInBodyAction,
  importInBodyCsvAction,
  saveInBodyAction,
  testInBodyAction,
} from "@/app/settings/integrations/inbody/actions";

interface Props {
  connection: {
    account: string;
    hasApiKey: boolean;
    region: "eur" | "usa" | "aus";
    lastTestAt: number | null;
    lastTestOk: boolean | null;
    lastError: string | null;
    lastWebhookAt: number | null;
  };
  regions: { value: "eur" | "usa" | "aus"; label: string }[];
  webhookUrl: string;
  serverIp: string | null;
  counts: { total: number; unmatched: number; pending: number };
  unmatched: ScanView[];
  recent: (ScanView & { clientName: string | null })[];
  people: { id: number; name: string; phone: string }[];
}

function when(ms: number | null): string {
  if (!ms) return "never";
  return new Date(ms).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" });
}

export function InBodySettings({ connection, regions, webhookUrl, serverIp, counts, unmatched, recent, people }: Props) {
  const router = useRouter();
  const [account, setAccount] = useState(connection.account);
  const [apiKey, setApiKey] = useState("");
  const [region, setRegion] = useState(connection.region);
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();
  const [copied, setCopied] = useState(false);
  const connected = Boolean(connection.account && connection.hasApiKey);

  function save() {
    startSave(async () => {
      const r = await saveInBodyAction({ account, apiKey: apiKey || undefined, region });
      if (!r.ok) return void toast.error(r.error);
      setApiKey("");
      toast.success("InBody details saved");
      router.refresh();
    });
  }

  function test() {
    startTest(async () => {
      const r = await testInBodyAction();
      if (r.ok) toast.success("Connected to InBody");
      else toast.error(r.error);
      router.refresh();
    });
  }

  function disconnect() {
    startSave(async () => {
      await disconnectInBodyAction();
      toast.success("InBody disconnected. Scans already saved are kept.");
      router.refresh();
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Couldn't copy. Select the address and copy it by hand.");
    }
  }

  const status = connected
    ? connection.lastTestOk === false
      ? { tone: "is-bad", text: "Details saved, but InBody refused the last test" }
      : connection.lastTestOk
        ? { tone: "is-good", text: "Connected" }
        : { tone: "is-wait", text: "Details saved, not tested yet" }
    : { tone: "is-wait", text: "Not connected" };

  return (
    <div className="ib-layout">
      <div className="ib-main">
        <section className="ib-panel">
          <header className="ib-panel-head">
            <div>
              <h2>Connection</h2>
              <p className={`ib-status ${status.tone}`}>
                <span className="ib-dot" aria-hidden />
                {status.text}
              </p>
            </div>
            {connected && (
              <Button variant="ghost" size="sm" onClick={disconnect} disabled={saving}>
                <Unplug size={14} /> Disconnect
              </Button>
            )}
          </header>

          <ol className="ib-steps">
            <li>
              <div className="ib-step-title">Apply for InBody API access</div>
              <p>
                In LookinBody Web, apply for API access (a paid add-on InBody approves). Once approved, sign in to the InBody API site for your
                region and open <b>Setup</b>.
              </p>
            </li>
            <li>
              <div className="ib-step-title">Paste this webhook address into InBody</div>
              <p>InBody sends each new scan here. Press <b>Send test</b> in InBody to check it, then save.</p>
              <div className="ib-copy">
                <code>{webhookUrl}</code>
                <Button variant="secondary" size="sm" onClick={copy}>
                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="ib-note">
                InBody also asks for this server&rsquo;s IP address.{" "}
                {serverIp ? (
                  <>
                    Enter <code>{serverIp}</code>.
                  </>
                ) : (
                  <>Your account manager will give you it.</>
                )}
              </p>
            </li>
            <li>
              <div className="ib-step-title">Add the account name and API key</div>
              <p>Create the key in the same Setup screen. The account name is the one you sign in to LookinBody Web with.</p>
              <div className="ib-form">
                <div>
                  <Label htmlFor="ib-account">LookinBody account name</Label>
                  <Input id="ib-account" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="LookinBody account name" autoComplete="off" />
                </div>
                <div>
                  <Label htmlFor="ib-key">API key</Label>
                  <PasswordInput
                    id="ib-key"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={connection.hasApiKey ? "Saved. Paste a new key to replace it" : "API key"}
                    autoComplete="off"
                  />
                </div>
                <div>
                  <Label htmlFor="ib-region">Region</Label>
                  <select id="ib-region" value={region} onChange={(e) => setRegion(e.target.value as Props["connection"]["region"])} className="ib-select">
                    {regions.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="ib-actions">
                <Button onClick={save} loading={saving} disabled={!account.trim()}>
                  Save
                </Button>
                <Button variant="outline" onClick={test} loading={testing} disabled={!connected}>
                  Test connection
                </Button>
              </div>
              {connection.lastTestOk === false && connection.lastError && <p className="ib-error">{connection.lastError}</p>}
            </li>
          </ol>
        </section>

        <section className="ib-panel">
          <header className="ib-panel-head">
            <div>
              <h2>Scans to match</h2>
              <p className="ib-sub">
                {unmatched.length === 0
                  ? "Every scan is matched to a client."
                  : "These scans didn't match a client by phone number or InBody ID. Pick who each one belongs to; their next scans will match on their own."}
              </p>
            </div>
            <span className="ib-count">{counts.unmatched}</span>
          </header>
          {unmatched.length > 0 && (
            <ul className="ib-list">
              {unmatched.map((s) => (
                <UnmatchedRow key={s.id} scan={s} people={people} />
              ))}
            </ul>
          )}
        </section>

        <section className="ib-panel">
          <header className="ib-panel-head">
            <div>
              <h2>Latest scans</h2>
              <p className="ib-sub">{counts.total === 0 ? "No scans yet." : `${counts.total} scans saved.`}</p>
            </div>
          </header>
          {recent.length > 0 && (
            <div className="ib-table-wrap">
              <table className="ib-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Client</th>
                    {HEADLINE_METRICS.slice(0, 4).map((k) => (
                      <th key={k}>{k === "smm" ? "Muscle" : k === "pbf" ? "Body fat" : k === "bfm" ? "Fat mass" : "Weight"}</th>
                    ))}
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((s) => (
                    <tr key={s.id}>
                      <td>{when(s.measuredAt)}</td>
                      <td>
                        {s.clientId ? (
                          <a href={`/clients/${s.clientId}`} className="ib-link">
                            {s.clientName ?? "Client"}
                          </a>
                        ) : (
                          <span className="ib-muted">Not matched</span>
                        )}
                      </td>
                      {HEADLINE_METRICS.slice(0, 4).map((k) => (
                        <td key={k}>{formatMetric(k, s.metrics[k])}</td>
                      ))}
                      <td>
                        {s.resultStatus === "fetched" ? (
                          <span className="ib-pill is-good">Results in</span>
                        ) : s.resultStatus === "error" ? (
                          <span className="ib-pill is-bad" title={s.error ?? undefined}>Waiting on InBody</span>
                        ) : (
                          <span className="ib-pill">Fetching</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <aside className="ib-side">
        <div className="ib-panel ib-facts">
          <div className="ib-fact">
            <span>Scans saved</span>
            <strong>{counts.total}</strong>
          </div>
          <div className="ib-fact">
            <span>Waiting to match</span>
            <strong>{counts.unmatched}</strong>
          </div>
          <div className="ib-fact">
            <span>Last scan from InBody</span>
            <strong>{when(connection.lastWebhookAt)}</strong>
          </div>
          <div className="ib-fact">
            <span>Last connection test</span>
            <strong>{when(connection.lastTestAt)}</strong>
          </div>
        </div>
        <CsvImport />
        <div className="ib-panel ib-privacy">
          <h3>Who sees the results</h3>
          <p>
            Staff see every client&rsquo;s scans on their profile. A client sees their own in the app only after they choose to, and can turn it
            off again.
          </p>
        </div>
      </aside>
    </div>
  );
}

function UnmatchedRow({ scan, people }: { scan: ScanView; people: Props["people"] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<{ id: number; name: string } | null>(null);
  const [pending, start] = useTransition();
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2 || picked) return [];
    const digits = q.replace(/\D/g, "");
    return people
      .filter((p) => p.name.toLowerCase().includes(q) || (digits.length >= 3 && p.phone.replace(/\D/g, "").includes(digits)))
      .slice(0, 6);
  }, [query, people, picked]);

  const who = [scan.name, scan.phone, scan.inbodyUserId ? `InBody ID ${scan.inbodyUserId}` : null].filter(Boolean).join(" · ") || "No name or number on the scan";

  function match() {
    if (!picked) return;
    start(async () => {
      const r = await assignScanAction(scan.id, picked.id);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.alsoMatched > 0 ? `Matched to ${picked.name}, with ${r.alsoMatched} more of their scans` : `Matched to ${picked.name}`);
      router.refresh();
    });
  }

  function remove() {
    start(async () => {
      await deleteScanAction(scan.id);
      toast.success("Scan deleted");
      router.refresh();
    });
  }

  return (
    <li className="ib-row">
      <div className="ib-row-text">
        <div className="ib-row-title">{when(scan.measuredAt)}</div>
        <div className="ib-row-sub">{who}</div>
        <div className="ib-row-metrics">
          {HEADLINE_METRICS.slice(0, 3).map((k) => (
            <span key={k}>{formatMetric(k, scan.metrics[k])}</span>
          ))}
        </div>
      </div>
      <div className="ib-row-actions">
        <div className="ib-picker">
          <Input
            value={picked ? picked.name : query}
            onChange={(e) => {
              setPicked(null);
              setQuery(e.target.value);
            }}
            placeholder="Search name or phone"
            aria-label="Client this scan belongs to"
          />
          {matches.length > 0 && (
            <ul className="ib-picker-list" role="listbox">
              {matches.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => setPicked({ id: p.id, name: p.name })}>
                    <span>{p.name}</span>
                    <span className="ib-muted">{p.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button size="sm" onClick={match} loading={pending} disabled={!picked}>
          <Link2 size={14} /> Match
        </Button>
        <Button size="icon" variant="ghost" onClick={remove} disabled={pending} aria-label="Delete this scan">
          <Trash2 size={15} />
        </Button>
      </div>
    </li>
  );
}

function CsvImport() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();

  function onFile(file: File | undefined) {
    if (!file) return;
    start(async () => {
      const text = await file.text();
      const r = await importInBodyCsvAction(text);
      if (inputRef.current) inputRef.current.value = "";
      if (!r.ok) return void toast.error(r.error);
      const parts = [`${r.created} new`, r.updated ? `${r.updated} updated` : "", `${r.matched} matched to clients`, r.skipped ? `${r.skipped} rows skipped` : ""].filter(Boolean);
      toast.success(`Scans imported: ${parts.join(", ")}`);
      router.refresh();
    });
  }

  return (
    <div className="ib-panel">
      <h3>Import past scans</h3>
      <p>
        In LookinBody Web, export your results as a CSV file and add it here. This works before the API is approved, and a scan
        imported twice is only kept once.
      </p>
      <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      <Button variant="outline" onClick={() => inputRef.current?.click()} loading={pending}>
        <FileUp size={15} /> Choose CSV file
      </Button>
    </div>
  );
}
