import Link from "next/link";
import { UserPlus, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Reveal, RevealGroup } from "@/components/motion/Reveal";
import { ClientSearch } from "@/components/clients/ClientSearch";
import { ClientsToolbar } from "@/components/clients/ClientsToolbar";
import { FilterTabs } from "@/components/clients/FilterTabs";
import {
  listClients,
  type ClientListFilter,
  getTherapyMap,
} from "@/lib/queries";
import { db, schema } from "@/lib/db";
import { desc, eq, inArray } from "drizzle-orm";
import { formatDate, initialsOf } from "@/lib/utils";
import { getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: { q?: string; filter?: string };
}

export default async function ClientsPage({ searchParams }: Props) {
  const vocab = getVocab(getVenueType());
  const filter = (searchParams.filter ?? "all") as ClientListFilter;
  const q = searchParams.q ?? "";
  const list = await listClients({ q, filter });
  const therapyMap = await getTherapyMap();

  // Pull most recent appointments per client for "last visit" + therapy badges
  const ids = list.map((c) => c.id);
  const lastVisits = ids.length
    ? db
        .select()
        .from(schema.appointments)
        .where(inArray(schema.appointments.clientId, ids))
        .orderBy(desc(schema.appointments.date))
        .all()
    : [];

  const lastVisitMap = new Map<number, string>();
  const therapiesByClient = new Map<number, Set<number>>();
  for (const a of lastVisits) {
    if (!lastVisitMap.has(a.clientId)) lastVisitMap.set(a.clientId, a.date);
    const set = therapiesByClient.get(a.clientId) ?? new Set();
    for (const tid of JSON.parse(a.therapyIds || "[]") as number[]) set.add(tid);
    therapiesByClient.set(a.clientId, set);
  }

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="People"
        title={vocab.members}
        actions={<ClientsToolbar addLabel={`Add ${vocab.member.toLowerCase()}`} />}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 24,
          flexWrap: "wrap",
        }}
      >
        <ClientSearch />
        <FilterTabs />
        <div style={{ marginLeft: "auto", color: "var(--text-tertiary)", fontSize: 13 }}>
          {list.length}{" "}
          {list.length === 1
            ? vocab.member.toLowerCase()
            : vocab.members.toLowerCase()}
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={<Users size={32} strokeWidth={1.4} />}
          title={q ? "No matches" : `No ${vocab.members.toLowerCase()} yet`}
          message={
            q
              ? "Try a different search term."
              : `Add your first ${vocab.member.toLowerCase()} to start tracking sessions.`
          }
          action={
            !q && (
              <Link href="/clients/new">
                <Button>
                  <UserPlus size={15} />
                  Add {vocab.member.toLowerCase()}
                </Button>
              </Link>
            )
          }
        />
      ) : (
        <RevealGroup
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {list.map((c) => {
            const lastVisit = lastVisitMap.get(c.id);
            const tids = [...(therapiesByClient.get(c.id) ?? [])];
            return (
              <Reveal key={c.id}>
              <Link
                href={`/clients/${c.id}`}
                style={{ display: "block" }}
              >
                <Card interactive>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <Avatar initials={initialsOf(c.firstName, c.lastName)} size={44} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          color: "var(--text-primary)",
                          fontWeight: 500,
                          fontSize: 15,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c.firstName} {c.lastName}
                      </div>
                      <div
                        style={{
                          color: "var(--text-tertiary)",
                          fontSize: 12,
                          marginTop: 2,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c.email ?? c.phone}
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: 14,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                    }}
                  >
                    {tids.length === 0 ? (
                      <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>
                        No sessions yet
                      </span>
                    ) : (
                      tids.map((tid) => {
                        const t = therapyMap.get(tid);
                        if (!t) return null;
                        return (
                          <Badge key={tid} colour={t.colourHex}>
                            {t.name}
                          </Badge>
                        );
                      })
                    )}
                  </div>
                  <div
                    style={{
                      marginTop: 14,
                      paddingTop: 14,
                      borderTop: "1px solid var(--hairline)",
                      display: "flex",
                      justifyContent: "space-between",
                      color: "var(--text-tertiary)",
                      fontSize: 12,
                    }}
                  >
                    <span>{c.phone}</span>
                    <span>
                      {lastVisit ? `Last visit ${formatDate(lastVisit)}` : "Not visited"}
                    </span>
                  </div>
                </Card>
              </Link>
              </Reveal>
            );
          })}
        </RevealGroup>
      )}
    </div>
  );
}
