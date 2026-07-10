import { requireClientPage } from "@/lib/clientAuth";
import { clientMembership } from "@/lib/clientApp";
import { Card, dayLabel, euros, PageTitle } from "@/components/clientapp/ui";

export const dynamic = "force-dynamic";

export default async function ClientMembershipPage() {
  const { clientId } = requireClientPage();
  const m = clientMembership(clientId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageTitle>Membership</PageTitle>

      {m ? (
        <>
          <Card style={{ padding: 20 }}>
            <div style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: 22, color: "var(--text-primary)" }}>{m.name}</div>
            {m.category && <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", marginTop: 2 }}>{m.category}</div>}
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 12 }}>
              <span style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: 26, color: "var(--text-primary)" }}>{euros(m.priceCents)}</span>
              <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>/ month</span>
            </div>
            <span style={{ display: "inline-block", marginTop: 12, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "var(--font-mono), monospace", padding: "3px 10px", borderRadius: 5, background: "rgba(34,197,94,0.14)", color: "#22c55e" }}>
              {m.status}
            </span>
          </Card>

          <Card>
            <Row label="Started" value={dayLabel(m.startDate, { day: "numeric", month: "long", year: "numeric" })} />
            <div style={{ height: 1, background: "var(--hairline)", margin: "10px 0" }} />
            <Row label="Next billing" value={m.nextBillingDate ? dayLabel(m.nextBillingDate, { day: "numeric", month: "long", year: "numeric" }) : "—"} />
          </Card>
        </>
      ) : (
        <Card>
          <div style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 600 }}>No active membership</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>Speak to your coach to set up a membership.</div>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ fontSize: 13.5, color: "var(--text-primary)", fontWeight: 500 }}>{value}</span>
    </div>
  );
}
