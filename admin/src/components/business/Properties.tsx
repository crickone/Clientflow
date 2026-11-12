"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

import { notify } from "@/lib/toast";
import { setMetaAction } from "@/app/(console)/gyms/[id]/business-actions";
import { STAGE_LABEL, type PlatformStaffRow, type Stage, type TenantMeta } from "@/lib/types";

const STAGES: Stage[] = ["trial", "onboarding", "active", "at_risk", "churned"];

/** Stage, owner, tags: the strip under the business header. Each control saves on change. */
export function Properties({ tenantId, meta, staff }: { tenantId: number; meta: TenantMeta; staff: PlatformStaffRow[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [tag, setTag] = useState("");
  const save = (patch: Parameters<typeof setMetaAction>[1], okMsg: string) =>
    start(async () => {
      const r = await setMetaAction(tenantId, patch);
      if (r.ok) { notify.ok(okMsg); router.refresh(); } else notify.fail(r.error);
    });
  return (
    <div className="props">
      <label className="prop">
        <span className="prop-label">Stage</span>
        <select className="input" value={meta.stage ?? ""} onChange={(e) => save({ stage: (e.target.value || null) as Stage | null }, "Stage saved")}>
          <option value="">Auto: {STAGE_LABEL[meta.stageAuto]}</option>
          {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
        </select>
      </label>
      <label className="prop">
        <span className="prop-label">Owner</span>
        <select className="input" value={meta.ownerUserId ?? ""} onChange={(e) => save({ ownerUserId: e.target.value ? Number(e.target.value) : null }, "Owner saved")}>
          <option value="">Nobody</option>
          {staff.map((s) => <option key={s.userId} value={s.userId}>{s.name ?? s.email}</option>)}
        </select>
      </label>
      <div className="prop prop--tags">
        <span className="prop-label">Tags</span>
        <span className="tags">
          {meta.tags.map((t) => (
            <span key={t} className="chip">
              {t}
              <button type="button" aria-label={`Remove ${t}`} onClick={() => save({ tags: meta.tags.filter((x) => x !== t) }, "Tag removed")}><X size={11} /></button>
            </span>
          ))}
          <input
            className="input tag-input"
            placeholder="Add tag"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && tag.trim()) { e.preventDefault(); save({ tags: [...meta.tags, tag] }, "Tag added"); setTag(""); }
            }}
          />
        </span>
      </div>
    </div>
  );
}
