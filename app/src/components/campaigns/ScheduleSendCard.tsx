"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { scheduleCampaignAction, unscheduleCampaignAction } from "@/app/campaigns/actions";

/**
 * Book (or unbook) an email campaign's send time. Sits under the composer on
 * the campaign page. Times are entered in the browser's local time -- the
 * operator's own clock -- and sent as an ISO instant, so the server never
 * guesses a zone.
 */
export function ScheduleSendCard({
  campaignId,
  status,
  scheduledAt,
  lastError,
}: {
  campaignId: number;
  status: string;
  scheduledAt: number | null;
  lastError: string | null;
}) {
  const router = useRouter();
  const [when, setWhen] = useState("");
  const [pending, start] = useTransition();

  const scheduled = status === "scheduled" && scheduledAt != null;

  function schedule() {
    if (!when) {
      toast.error("Pick a date and time first.");
      return;
    }
    const at = new Date(when);
    if (!Number.isFinite(at.getTime())) {
      toast.error("That is not a valid date and time.");
      return;
    }
    start(async () => {
      const res = await scheduleCampaignAction(campaignId, at.toISOString());
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Scheduled.");
      router.refresh();
    });
  }

  function unschedule() {
    start(async () => {
      const res = await unscheduleCampaignAction(campaignId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Back to draft.");
      router.refresh();
    });
  }

  if (status !== "draft" && !scheduled) return null;

  return (
    <Card style={{ padding: 20, marginTop: 24, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <CalendarClock size={16} strokeWidth={1.75} />
        <strong style={{ fontSize: 14, color: "var(--text-primary)" }}>Send later</strong>
      </div>

      {scheduled ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>
            Sends on <strong style={{ color: "var(--text-primary)" }}>{new Date(scheduledAt!).toLocaleString("en-IE")}</strong>. The usual checks run at that time.
          </span>
          <Button variant="outline" onClick={unschedule} disabled={pending}>
            {pending ? <Loader2 size={14} className="spin" /> : <X size={14} />} Cancel schedule
          </Button>
        </div>
      ) : (
        <>
          {lastError && (
            <div style={{ fontSize: 12.5, color: "var(--danger, #e5484d)", lineHeight: 1.5 }}>
              The last scheduled send did not go: {lastError}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 220px" }}>
              <Label htmlFor="send-at">Date and time</Label>
              <Input id="send-at" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
            <Button onClick={schedule} disabled={pending || !when}>
              {pending ? <Loader2 size={14} className="spin" /> : <CalendarClock size={14} />} Schedule send
            </Button>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
            Save the draft first. Sending needs a verified domain and enough credits at send time; if a check fails the campaign returns to draft with the reason shown here.
          </div>
        </>
      )}
    </Card>
  );
}
