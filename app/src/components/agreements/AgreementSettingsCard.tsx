"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileCheck2, FileText, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/Card";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { Switch } from "@/components/forms/FormsListView";
import { DocText } from "@/components/agreements/DocText";
import type { AgreementDoc } from "@/lib/agreementsModel";
import { saveAgreementSettingsAction } from "@/app/my-app/actions";

/**
 * Staff side of "agree before using the app": the switch, the documents a
 * member will see (ours to preview, the business's to edit in Forms) and the
 * Welcome Q&A to ask after them.
 */
export function AgreementSettingsCard({
  on,
  welcomeFormId,
  docs,
  choices,
  isAdmin,
}: {
  on: boolean;
  welcomeFormId: number | null;
  docs: AgreementDoc[];
  choices: { id: number; title: string; status: boolean }[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<AgreementDoc | null>(null);
  const ours = docs.filter((d) => d.owner === "platform");
  const theirs = docs.filter((d) => d.owner === "business");

  function save(next: { on: boolean; welcomeFormId: number | null }) {
    start(async () => {
      const r = await saveAgreementSettingsAction(next);
      if (!r.ok) toast.error(r.error);
      else toast.success(next.on !== on ? (next.on ? "Members now agree before using the app." : "Turned off.") : "Saved.");
      router.refresh();
    });
  }

  return (
    <Card className="as-card">
      <div className="as-head">
        <span className="as-icon" aria-hidden>
          <FileCheck2 size={18} />
        </span>
        <div className="as-head-text">
          <b>Agree before using the app</b>
          <span>
            Members tick each document below, then answer your Welcome Q&amp;A, before the app opens. Anyone already using the app is asked next time they open it, and again whenever a
            document changes.
          </span>
        </div>
        <Switch on={on} disabled={!isAdmin || pending} onClick={() => save({ on: !on, welcomeFormId })} />
      </div>

      <div className="as-section">
        <div className="as-label">From us, the same for every business</div>
        {ours.map((d) => (
          <button key={d.key} type="button" className="as-doc" onClick={() => setPreview(d)}>
            <FileText size={15} aria-hidden />
            <span>{d.title}</span>
            <em>Version {d.version}. Preview</em>
          </button>
        ))}
      </div>

      <div className="as-section">
        <div className="as-label">Your Terms &amp; Conditions</div>
        {theirs.length === 0 ? (
          <p className="as-empty">
            None switched on yet. Members will only see ours until you add yours.{" "}
            <Link href="/forms/terms/new">
              <Plus size={13} /> Add terms
            </Link>
          </p>
        ) : (
          theirs.map((d) => (
            <div key={d.key} className="as-doc as-doc--static">
              <FileText size={15} aria-hidden />
              <span>{d.title}</span>
              <Link href={`/forms/terms/${d.key.slice(5)}`}>
                <Pencil size={13} /> Edit
              </Link>
            </div>
          ))
        )}
      </div>

      <div className="as-section">
        <label className="as-label" htmlFor="as-welcome">
          Welcome Q&amp;A, asked after the documents
        </label>
        <select
          id="as-welcome"
          className="as-select"
          value={welcomeFormId ?? ""}
          disabled={!isAdmin || pending}
          onChange={(e) => save({ on, welcomeFormId: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">None</option>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title || `Questionnaire ${c.id}`}
              {c.status ? "" : " (switched off)"}
            </option>
          ))}
        </select>
        <p className="as-hint">
          Build it under <Link href="/forms/initial">Forms, Initial Questionnaire</Link>. Use the &ldquo;Tick to confirm&rdquo; question type for lines a member must agree to.
        </p>
      </div>

      {!isAdmin && <p className="as-hint">Only an admin can change these.</p>}

      <Dialog open={preview !== null} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent title={preview?.title} width={640}>
          <div style={{ maxHeight: "65vh", overflowY: "auto", paddingRight: 6 }}>{preview && <DocText body={preview.body} />}</div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
