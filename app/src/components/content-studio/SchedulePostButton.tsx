"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarClock, Send, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/Dialog";
import { Input, Label } from "@/components/ui/Input";
import { cancelPostAction, publishPostNowAction, schedulePostAction } from "@/app/marketing/schedule/actions";

/**
 * Schedule or post a design from the editor it was made in. The button opens
 * one dialog: a time and the channels, then Schedule or Post now. The design's
 * own bookings (scheduled, posted, failed with Meta's reason) are listed there,
 * so the outcome of a post is visible where the post lives.
 */

export interface DesignBooking {
  id: number;
  scheduledFor: number;
  status: "scheduled" | "posting" | "posted" | "failed" | "cancelled";
  error: string | null;
  channels: string[];
}

const fmt = (ms: number) =>
  new Date(ms).toLocaleString("en-IE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" });

const TONE = { scheduled: "info", posting: "info", posted: "success", failed: "danger", cancelled: "neutral" } as const;
const LABEL = { scheduled: "Scheduled", posting: "Posting", posted: "Posted", failed: "Failed", cancelled: "Cancelled" } as const;

export function SchedulePostButton({
  designId,
  postable,
  connected,
  bookings,
  prepare,
}: {
  designId: number;
  /** The design has server-rendered slides, so it can go out on its own. */
  postable: boolean;
  /** A Facebook Page is connected for this business. */
  connected: boolean;
  bookings: DesignBooking[];
  /**
   * Runs before a schedule or a post: saves pictures of any template slides
   * so the publisher has images to send. Resolves to an error message, or null.
   */
  prepare?: () => Promise<string | null>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [at, setAt] = useState("");
  const [facebook, setFacebook] = useState(true);
  const [instagram, setInstagram] = useState(true);

  const upcoming = bookings.filter((b) => b.status === "scheduled").sort((a, b) => a.scheduledFor - b.scheduledFor)[0];
  const shown = bookings.filter((b) => b.status !== "cancelled").sort((a, b) => b.scheduledFor - a.scheduledFor).slice(0, 5);
  const channels = [facebook ? "facebook" : null, instagram ? "instagram" : null].filter((c): c is string => !!c);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    if (channels.length === 0) return void toast.error("Pick Facebook, Instagram or both.");
    start(async () => {
      const failed = prepare ? await prepare() : null;
      if (failed) return void toast.error(failed);
      const res = await fn();
      if (!res.ok) return void toast.error(res.error);
      toast.success(done);
      setAt("");
      router.refresh();
    });
  }

  function schedule() {
    const d = new Date(at);
    if (!at || !Number.isFinite(d.getTime())) return void toast.error("Pick a date and time.");
    run(() => schedulePostAction({ designId, whenIso: d.toISOString(), channels }), "Scheduled");
  }

  function cancel(id: number) {
    start(async () => {
      const res = await cancelPostAction(id);
      if (!res.ok) return void toast.error(res.error);
      toast.success("Taken off the schedule");
      router.refresh();
    });
  }

  const blocked = !postable
    ? "This post isn't ready to go out yet. Wait for its slides to finish, then try again."
    : !connected
      ? "Connect your Facebook Page first, in Settings > Integrations > Facebook."
      : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" title="Schedule this post, or post it now">
          <CalendarClock size={14} />
          {upcoming ? `Scheduled ${fmt(upcoming.scheduledFor)}` : "Schedule"}
        </Button>
      </DialogTrigger>
      <DialogContent title="Schedule this post" description="Pick when it goes out, or post it now." width={480}>
        <div style={{ display: "grid", gap: 16 }}>
          {blocked ? (
            <div style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.55 }}>
              {blocked}
              {!connected && postable && (
                <>
                  {" "}
                  <Link href="/settings/integrations/facebook" style={{ color: "var(--accent)" }}>
                    Open Facebook settings
                  </Link>
                </>
              )}
            </div>
          ) : (
            <>
              <div>
                <Label htmlFor="post-at">Date and time</Label>
                <Input id="post-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} disabled={pending} />
              </div>
              <div style={{ display: "flex", gap: 18, fontSize: 13.5, color: "var(--text-secondary)" }}>
                <label style={{ display: "flex", gap: 7, alignItems: "center" }}>
                  <input type="checkbox" checked={facebook} onChange={(e) => setFacebook(e.target.checked)} disabled={pending} /> Facebook
                </label>
                <label style={{ display: "flex", gap: 7, alignItems: "center" }}>
                  <input type="checkbox" checked={instagram} onChange={(e) => setInstagram(e.target.checked)} disabled={pending} /> Instagram
                </label>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Button onClick={schedule} loading={pending}>
                  <CalendarClock size={14} /> Schedule
                </Button>
                <Button variant="outline" onClick={() => run(() => publishPostNowAction({ designId, channels }), "Posted")} disabled={pending}>
                  <Send size={14} /> Post now
                </Button>
              </div>
            </>
          )}

          {shown.length > 0 && (
            <div style={{ display: "grid", gap: 10, borderTop: "1px solid var(--hairline)", paddingTop: 14 }}>
              {shown.map((b) => (
                <div key={b.id} style={{ display: "grid", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 }}>
                    <Badge tone={TONE[b.status]}>{LABEL[b.status]}</Badge>
                    <span style={{ color: "var(--text-primary)" }}>{fmt(b.scheduledFor)}</span>
                    <span style={{ color: "var(--text-tertiary)" }}>{b.channels.join(" + ")}</span>
                    {b.status === "scheduled" && (
                      <Button variant="ghost" size="sm" onClick={() => cancel(b.id)} disabled={pending} style={{ marginLeft: "auto" }}>
                        <X size={13} /> Cancel
                      </Button>
                    )}
                  </div>
                  {b.error && <div style={{ fontSize: 12.5, color: b.status === "failed" ? "var(--danger)" : "var(--text-tertiary)" }}>{b.error}</div>}
                </div>
              ))}
            </div>
          )}

          <Link href="/marketing/schedule" style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>
            See everything scheduled
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
