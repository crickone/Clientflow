"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarClock, Loader2, Mail, Image as ImageIcon, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Input, Label } from "@/components/ui/Input";
import { cancelPostAction, schedulePostAction, unscheduleEmailAction } from "@/app/marketing/schedule/actions";

export interface ScheduledPostRow {
  id: number;
  designId: number;
  designName: string;
  channels: string[];
  scheduledFor: number;
  status: string;
  note: string | null;
  slideCount: number;
}

export interface ScheduledEmailRow {
  id: number;
  name: string;
  subject: string;
  scheduledAt: number | null;
}

export interface DesignOption {
  id: number;
  name: string;
}

const POST_TONE: Record<string, "neutral" | "amber" | "green" | "red"> = {
  scheduled: "amber",
  posting: "amber",
  posted: "green",
  failed: "red",
  cancelled: "neutral",
};

function when(ms: number): string {
  return new Date(ms).toLocaleString("en-IE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function ScheduleBoard({
  posts,
  emails,
  designs,
  postingConnected,
  nurtureQueued,
}: {
  posts: ScheduledPostRow[];
  emails: ScheduledEmailRow[];
  designs: DesignOption[];
  postingConnected: boolean;
  nurtureQueued: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [designId, setDesignId] = useState<string>(designs[0] ? String(designs[0].id) : "");
  const [at, setAt] = useState("");
  const [facebook, setFacebook] = useState(true);
  const [instagram, setInstagram] = useState(true);

  function book() {
    const d = new Date(at);
    if (!designId) {
      toast.error("Pick a design.");
      return;
    }
    if (!at || !Number.isFinite(d.getTime())) {
      toast.error("Pick a date and time.");
      return;
    }
    const channels = [facebook ? "facebook" : null, instagram ? "instagram" : null].filter((c): c is string => !!c);
    if (channels.length === 0) {
      toast.error("Pick at least one channel.");
      return;
    }
    start(async () => {
      const res = await schedulePostAction({ designId: Number(designId), whenIso: d.toISOString(), channels });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Scheduled.");
      setAt("");
      router.refresh();
    });
  }

  function cancelPost(id: number) {
    start(async () => {
      const res = await cancelPostAction(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  function cancelEmail(id: number) {
    start(async () => {
      const res = await unscheduleEmailAction(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {!postingConnected && (
        <Card style={{ padding: 16, borderColor: "var(--warning, #d29922)" }}>
          <div style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
            <strong style={{ color: "var(--text-primary)" }}>Facebook is not connected yet.</strong> Meta&rsquo;s app review is in progress. Posts you schedule now wait here and go out automatically the moment the connection is live; nothing needs re-booking.
          </div>
        </Card>
      )}

      <Card style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <CardLabel>Schedule a post</CardLabel>
        {designs.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>
            No finished designs yet. Make one in <Link href="/content-studio/images/new" style={{ color: "var(--accent)" }}>Content Studio</Link> or ask Adonis for the week&rsquo;s posts.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1.4fr auto auto", gap: 12, alignItems: "end" }} className="schedule-form">
            <div>
              <Label htmlFor="sched-design">Design</Label>
              <select
                id="sched-design"
                value={designId}
                onChange={(e) => setDesignId(e.target.value)}
                style={{ width: "100%", height: 40, padding: "0 12px", borderRadius: "var(--radius)", border: "1px solid var(--hairline)", background: "var(--surface-1)", color: "var(--text-primary)", fontSize: 13 }}
              >
                {designs.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="sched-at">Date and time</Label>
              <Input id="sched-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
            </div>
            <div style={{ display: "flex", gap: 12, paddingBottom: 10, fontSize: 13, color: "var(--text-secondary)" }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={facebook} onChange={(e) => setFacebook(e.target.checked)} /> Facebook
              </label>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={instagram} onChange={(e) => setInstagram(e.target.checked)} /> Instagram
              </label>
            </div>
            <Button onClick={book} disabled={pending}>
              {pending ? <Loader2 size={14} className="spin" /> : <CalendarClock size={14} />} Schedule
            </Button>
          </div>
        )}
      </Card>

      <Card style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <ImageIcon size={16} strokeWidth={1.75} />
          <strong style={{ fontSize: 14, color: "var(--text-primary)" }}>Posts</strong>
        </div>
        {posts.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Nothing scheduled.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {posts.map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: "1px solid var(--hairline)", borderRadius: "var(--radius)", flexWrap: "wrap" }}>
                <div style={{ minWidth: 180, fontSize: 13.5, color: "var(--text-primary)", fontWeight: 500 }}>
                  <Link href={`/content-studio/images/${p.designId}`} style={{ color: "inherit", textDecoration: "none" }}>{p.designName}</Link>
                  <div style={{ fontSize: 12, color: "var(--text-tertiary)", fontWeight: 400 }}>
                    {p.slideCount} slide{p.slideCount === 1 ? "" : "s"} · {p.channels.join(" + ")}
                  </div>
                </div>
                <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{when(p.scheduledFor)}</div>
                <Badge tone={POST_TONE[p.status] ?? "neutral"}>{p.status}</Badge>
                {p.note && <span style={{ fontSize: 12, color: "var(--text-tertiary)", flex: "1 1 200px" }}>{p.note}</span>}
                {p.status === "scheduled" && (
                  <button
                    type="button"
                    onClick={() => cancelPost(p.id)}
                    disabled={pending}
                    aria-label={`Cancel ${p.designName}`}
                    style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, border: "none", background: "transparent", color: "var(--text-tertiary)", cursor: "pointer", fontSize: 12.5, fontFamily: "inherit" }}
                  >
                    <X size={13} /> Cancel
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Mail size={16} strokeWidth={1.75} />
          <strong style={{ fontSize: 14, color: "var(--text-primary)" }}>Email sends</strong>
          <span style={{ marginLeft: "auto", fontSize: 12.5, color: "var(--text-tertiary)" }}>
            Nurture sequence: {nurtureQueued} message{nurtureQueued === 1 ? "" : "s"} queued
          </span>
        </div>
        {emails.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>
            Nothing scheduled. Book a send from an email campaign&rsquo;s page, or ask Adonis to schedule a launched campaign&rsquo;s emails.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {emails.map((e) => (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", border: "1px solid var(--hairline)", borderRadius: "var(--radius)", flexWrap: "wrap" }}>
                <div style={{ minWidth: 180, fontSize: 13.5, color: "var(--text-primary)", fontWeight: 500 }}>
                  <Link href={`/campaigns/${e.id}`} style={{ color: "inherit", textDecoration: "none" }}>{e.name}</Link>
                  <div style={{ fontSize: 12, color: "var(--text-tertiary)", fontWeight: 400 }}>{e.subject}</div>
                </div>
                <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{e.scheduledAt ? when(e.scheduledAt) : "no time"}</div>
                <Badge tone="amber">scheduled</Badge>
                <button
                  type="button"
                  onClick={() => cancelEmail(e.id)}
                  disabled={pending}
                  aria-label={`Cancel ${e.name}`}
                  style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, border: "none", background: "transparent", color: "var(--text-tertiary)", cursor: "pointer", fontSize: 12.5, fontFamily: "inherit" }}
                >
                  <X size={13} /> Cancel
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
