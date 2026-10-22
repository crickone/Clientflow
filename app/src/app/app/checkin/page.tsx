import { redirect } from "next/navigation";
import { CircleCheck } from "lucide-react";

import { requireClientPage } from "@/lib/clientAuth";
import { listCheckins, memberCheckin } from "@/lib/checkins";
import { photoNames, WEEKDAYS } from "@/lib/memberChoicesModel";
import { Card, PageTitle, SectionTitle } from "@/components/clientapp/ui";
import { CheckinForm } from "@/components/clientapp/CheckinForm";

export const dynamic = "force-dynamic";

function longDay(day: string) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}
function at(ms: number) {
  return new Date(ms).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Dublin" });
}

/** This week's check-in, and the ones sent before. */
export default async function CheckinPage(props: { searchParams: Promise<{ sent?: string; again?: string }> }) {
  const searchParams = await props.searchParams;
  const { clientId } = requireClientPage();
  const c = memberCheckin(clientId);
  if (!c) redirect("/app");
  const past = listCheckins(clientId, 20);
  const showForm = c.due || searchParams.again === "1";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageTitle sub={`Every ${WEEKDAYS[c.weekday - 1]}`}>Check-in</PageTitle>

      {showForm ? (
        <>
          {c.due && (
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "var(--text-secondary)" }}>
              {c.daysLate === 0 ? "Due today." : `Due since ${longDay(c.since)}.`} Your answers and photos go to your coach.
            </p>
          )}
          <CheckinForm questions={c.form.questions} />
        </>
      ) : (
        <Card style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <CircleCheck size={22} style={{ color: "var(--success)", flexShrink: 0, marginTop: 1 }} />
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>{searchParams.sent ? "Check-in sent" : "Done for this week"}</div>
            <div style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>Your next check-in is due {longDay(c.next)}.</div>
            <a href="/app/checkin?again=1" style={{ fontSize: 13, color: "var(--accent-ink)", fontWeight: 500, marginTop: 4 }}>
              Send another
            </a>
          </div>
        </Card>
      )}

      {past.length > 0 && (
        <div>
          <SectionTitle>Sent</SectionTitle>
          <div style={{ display: "grid", gap: 8 }}>
            {past.map((p) => (
              <details key={p.id} className="ci-past">
                <summary>
                  <b>{at(p.at)}</b>
                  <span>{p.formTitle}</span>
                </summary>
                <div className="wq" style={{ padding: "4px 14px 12px" }}>
                  {p.answers
                    .filter((a) => a.fieldType !== "video")
                    .map((a) => (
                      <div key={a.questionId} className="wq-row">
                        <span className="wq-q">{a.label}</span>
                        {a.fieldType === "photo" ? (
                          <div className="ci-photos">
                            {photoNames(a.value).map((n) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img key={n} className="ci-thumb" src={`/api/app/checkins/photo?name=${encodeURIComponent(n)}`} alt="" />
                            ))}
                            {photoNames(a.value).length === 0 && <span className="wq-a">No photo</span>}
                          </div>
                        ) : (
                          <span className="wq-a">{a.fieldType === "confirm" ? (a.value === "yes" ? "Ticked" : "Not ticked") : a.value || "No answer"}</span>
                        )}
                      </div>
                    ))}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
