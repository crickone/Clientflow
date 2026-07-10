import Link from "next/link";
import { Package as PackageIcon, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  getTherapyMap,
  listPackages,
} from "@/lib/queries";
import { db, schema } from "@/lib/db";
import { inArray } from "drizzle-orm";
import { formatDate, formatEur } from "@/lib/utils";
import { getVenueType } from "@/lib/settings";
import { getVocab } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "active", label: "Active" },
  { key: "expiring", label: "Expiring soon" },
  { key: "expired", label: "Expired" },
  { key: "all", label: "All" },
] as const;

interface Props {
  searchParams: { filter?: string };
}

export default async function PackagesPage({ searchParams }: Props) {
  const vocab = getVocab(getVenueType());
  const filter = (searchParams.filter ?? "active") as
    | "active"
    | "expiring"
    | "expired"
    | "all";
  const list = await listPackages(filter);
  const therapyMap = await getTherapyMap();
  const ids = [...new Set(list.map((p) => p.clientId))];
  const clients = ids.length
    ? new Map(
        db
          .select()
          .from(schema.clients)
          .where(inArray(schema.clients.id, ids))
          .all()
          .map((c) => [c.id, c]),
      )
    : new Map();

  return (
    <div className="app-page">
      <PageHeader
        eyebrow={vocab.plans}
        title="Session bundles"
        actions={
          <Link href="/packages/new">
            <Button>
              <Plus size={15} />
              Sell {vocab.plan.toLowerCase()}
            </Button>
          </Link>
        }
      />

      <div
        style={{
          display: "inline-flex",
          background: "var(--surface-1)",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius)",
          padding: 3,
          gap: 2,
          marginBottom: 24,
        }}
      >
        {TABS.map((t) => {
          const active = filter === t.key;
          const params = new URLSearchParams();
          if (t.key !== "active") params.set("filter", t.key);
          return (
            <Link
              key={t.key}
              href={`/packages${params.size ? "?" + params.toString() : ""}`}
              style={{
                padding: "6px 16px",
                borderRadius: "var(--radius)",
                fontSize: 13,
                fontWeight: 500,
                color: active ? "var(--text-primary)" : "var(--text-secondary)",
                background: active ? "var(--bg)" : "transparent",
                boxShadow: active ? "0 1px 3px -1px rgba(0,0,0,0.1)" : "none",
                transition: "all 0.15s var(--ease)",
              }}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={<PackageIcon size={32} strokeWidth={1.4} />}
          title={`No ${vocab.plans.toLowerCase()} here`}
          message={`Switch tabs to see other states, or sell a new ${vocab.plan.toLowerCase()}.`}
          action={
            <Link href="/packages/new">
              <Button>
                <Plus size={15} />
                Sell {vocab.plan.toLowerCase()}
              </Button>
            </Link>
          }
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 16,
          }}
        >
          {list.map((p) => {
            const t = therapyMap.get(p.therapyId);
            const c = clients.get(p.clientId);
            const today = new Date().toISOString().slice(0, 10);
            const expired = p.expiryDate < today;
            const pct = Math.min(100, (p.sessionsUsed / p.totalSessions) * 100);
            return (
              <Card key={p.id}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 10,
                  }}
                >
                  {t && <Badge colour={t.colourHex}>{t.name}</Badge>}
                  {expired ? (
                    <Badge tone="red">Expired</Badge>
                  ) : p.isActive ? (
                    <Badge tone="green">Active</Badge>
                  ) : (
                    <Badge>Inactive</Badge>
                  )}
                </div>
                <div style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                  {c ? (
                    <Link href={`/clients/${c.id}`} style={{ color: "inherit" }}>
                      {c.firstName} {c.lastName}
                    </Link>
                  ) : (
                    "—"
                  )}
                </div>
                <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 2 }}>
                  {p.packageName}
                </div>
                <div
                  style={{
                    margin: "14px 0 8px",
                    height: 6,
                    background: "var(--surface-2)",
                    borderRadius: "var(--radius)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      background: t?.colourHex ?? "var(--text-primary)",
                    }}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    color: "var(--text-tertiary)",
                    fontSize: 12,
                  }}
                >
                  <span>
                    {p.sessionsUsed} / {p.totalSessions} sessions
                  </span>
                  <span>{formatEur(p.pricePaidEur)}</span>
                </div>
                <div
                  style={{
                    color: "var(--text-tertiary)",
                    fontSize: 11,
                    marginTop: 8,
                  }}
                >
                  Purchased {formatDate(p.purchaseDate)} · expires{" "}
                  {formatDate(p.expiryDate)}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
