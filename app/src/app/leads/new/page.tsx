import { db } from "@/lib/db";
import { therapies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { createManualLeadAction } from "../actions";
import { getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

export default function NewLeadPage() {
  const vocab = getVocab(getVenueType());
  const therapyList = db
    .select()
    .from(therapies)
    .where(eq(therapies.isActive, true))
    .all();

  return (
    <div className="app-page" style={{ maxWidth: 720 }}>
      <PageHeader
        eyebrow="Pipeline"
        title="Add lead"
        subtitle="Use this for walk-up enquiries or to manually enter leads from elsewhere."
      />
      <form
        action={createManualLeadAction}
        style={{ display: "flex", flexDirection: "column", gap: 24 }}
      >
        <Card>
          <CardLabel>Person</CardLabel>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
            }}
          >
            <div>
              <Label htmlFor="firstName">First name *</Label>
              <Input id="firstName" name="firstName" required />
            </div>
            <div>
              <Label htmlFor="lastName">Last name</Label>
              <Input id="lastName" name="lastName" />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" name="phone" />
            </div>
          </div>
        </Card>

        <Card>
          <CardLabel>Interest</CardLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <Label htmlFor="therapyInterest">{vocab.service}</Label>
              <select
                id="therapyInterest"
                name="therapyInterest"
                defaultValue=""
                style={{
                  width: "100%",
                  background: "var(--bg)",
                  border: "1px solid var(--hairline)",
                  borderRadius: "var(--radius)",
                  padding: "10px 14px",
                  color: "var(--text-primary)",
                  fontSize: 14,
                  fontFamily: "inherit",
                }}
              >
                <option value="">Not sure / general</option>
                {therapyList.map((t) => (
                  <option key={t.id} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="campaign">Source / campaign</Label>
              <Input
                id="campaign"
                name="campaign"
                placeholder="e.g. HBOT - Apr 2026"
              />
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <Label htmlFor="notes">Notes from them</Label>
            <Textarea
              id="notes"
              name="notes"
              rows={3}
              placeholder="Anything they mentioned — what they're looking for, conditions, schedule…"
            />
          </div>
        </Card>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button type="submit">Add lead</Button>
        </div>
      </form>
    </div>
  );
}
