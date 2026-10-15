"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Lock, Smartphone } from "lucide-react";

import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { DocText } from "@/components/agreements/DocText";
import type { AgreementDoc } from "@/lib/agreementsModel";
import { WEEKDAYS } from "@/lib/memberChoicesModel";
import { setCheckinDayAction } from "@/app/forms/actions";

/**
 * What a Forms page does in the client app, said on the page itself:
 * Terms lock the app until signed, the Default questionnaire is asked once
 * after, the Default check-in falls due weekly.
 */
export function FormsAppNote(
  props:
    | { kind: "terms"; live: boolean; ours: AgreementDoc[]; progress: { members: number; signed: number } }
    | { kind: "initial"; live: string | null; termsLive: boolean }
    | { kind: "checkin"; live: string | null; weekday: number },
) {
  const [preview, setPreview] = useState<AgreementDoc | null>(null);
  const router = useRouter();
  const [pending, start] = useTransition();

  if (props.kind === "terms") {
    const { live, ours, progress } = props;
    return (
      <div className="fan" data-live={live}>
        <span className="fan-icon" aria-hidden>
          <Lock size={17} />
        </span>
        <div className="fan-text">
          <b>{live ? "Members must sign before they can use the app" : "Switch on a Terms & Conditions form to make members sign it"}</b>
          <span>
            {live
              ? `Every member gets your switched-on terms, plus our three documents below, the next time they open the app, and again whenever you change the wording. ${progress.members ? `${progress.signed} of ${progress.members} app members have signed.` : ""}`
              : "Once one is switched on, every member has to tick it, plus our three documents below, before the app opens."}
          </span>
          <div className="fan-docs">
            {ours.map((d) => (
              <button key={d.key} type="button" onClick={() => setPreview(d)}>
                <FileText size={13} /> {d.title}
              </button>
            ))}
          </div>
        </div>
        <Dialog open={preview !== null} onOpenChange={(o) => !o && setPreview(null)}>
          <DialogContent title={preview?.title} width={640}>
            <div style={{ maxHeight: "65vh", overflowY: "auto", paddingRight: 6 }}>{preview && <DocText body={preview.body} />}</div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  if (props.kind === "initial") {
    return (
      <div className="fan" data-live={Boolean(props.live)}>
        <span className="fan-icon" aria-hidden>
          <Smartphone size={17} />
        </span>
        <div className="fan-text">
          <b>{props.live ? `"${props.live}" is asked in the app` : "Make one the Default to ask it in the app"}</b>
          <span>
            {props.live
              ? `Every member answers the Default questionnaire once${props.termsLive ? ", straight after signing your terms," : ""} before the app opens. Their answers show on their client page.`
              : "The Default questionnaire, when switched on, is asked once before a member can use the app. Use the Tick to confirm question type for lines they must agree to."}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="fan" data-live={Boolean(props.live)}>
      <span className="fan-icon" aria-hidden>
        <Smartphone size={17} />
      </span>
      <div className="fan-text">
        <b>{props.live ? `"${props.live}" is due weekly in the app` : "Make one the Default to send it weekly in the app"}</b>
        <span>From the day below, members see Check-in due until they send it. Photo questions take up to three photos.</span>
        <label className="fan-day">
          Due every
          <select
            value={props.weekday}
            disabled={pending}
            onChange={(e) => {
              const d = Number(e.target.value);
              start(async () => {
                await setCheckinDayAction(d);
                router.refresh();
              });
            }}
          >
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i + 1}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
