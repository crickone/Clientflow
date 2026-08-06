"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { Lead } from "@/lib/db/schema";
import { Card } from "@/components/ui/Card";
import { Reveal, RevealGroup } from "@/components/motion/Reveal";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { StageChip } from "@/components/pipeline/StageChip";
import { STAGES, STAGE_ORDER, type PipelineStage } from "@/lib/pipeline/stages";
import { useVocab } from "@/components/providers/VocabProvider";
import { formatDate, initialsOf } from "@/lib/utils";

type Filter = PipelineStage | "all";

interface Props {
  leads: Lead[];
}

export function LeadList({ leads }: Props) {
  const vocab = useVocab();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  // Stage counts computed client-side from the full leads array.
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: leads.length };
    for (const l of leads) {
      const s = l.pipelineStage as PipelineStage;
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [leads]);

  // Only show stage tabs that have leads (keeps the bar tidy), plus "All".
  const tabs: { value: Filter; label: string }[] = useMemo(
    () => [
      { value: "all" as Filter, label: "All" },
      ...STAGE_ORDER.filter((s) => (counts[s] ?? 0) > 0).map((s) => ({
        value: s as Filter,
        label: STAGES[s].label,
      })),
    ],
    [counts],
  );

  const visible = useMemo(() => {
    let list =
      filter === "all" ? leads : leads.filter((l) => l.pipelineStage === filter);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter((l) =>
        [
          l.firstName,
          l.lastName,
          l.email,
          l.phone,
          l.therapyInterest,
          l.campaign,
          l.notes,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle),
      );
    }
    return list;
  }, [leads, filter, q]);

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <div style={{ position: "relative", flex: 1, maxWidth: 420 }}>
          <Search
            size={15}
            style={{
              position: "absolute",
              left: 14,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-tertiary)",
              pointerEvents: "none",
            }}
          />
          <Input
            placeholder={`Search by name, email, ${vocab.service.toLowerCase()}, campaign…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ paddingLeft: 38, borderRadius: "var(--radius)" }}
          />
        </div>
        <div
          style={{
            marginLeft: "auto",
            color: "var(--text-tertiary)",
            fontSize: 13,
          }}
        >
          {visible.length} of {leads.length}
        </div>
      </div>

      <div
        role="tablist"
        style={{
          display: "inline-flex",
          background: "var(--surface-1)",
          border: "1px solid var(--hairline)",
          borderRadius: "var(--radius)",
          padding: 3,
          gap: 2,
          marginBottom: 24,
          flexWrap: "wrap",
        }}
      >
        {tabs.map((t) => {
          const active = filter === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => setFilter(t.value)}
              style={{
                padding: "6px 14px",
                borderRadius: "var(--radius)",
                fontSize: 13,
                fontWeight: 500,
                color: active ? "var(--text-primary)" : "var(--text-secondary)",
                background: active ? "var(--bg)" : "transparent",
                boxShadow: active ? "0 1px 3px -1px rgba(0,0,0,0.1)" : "none",
                cursor: "pointer",
                border: "none",
                fontFamily: "inherit",
                transition: "all 0.15s var(--ease)",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {t.label}
              <span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>
                {counts[t.value] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div
          style={{
            padding: "48px 24px",
            background: "var(--surface-1)",
            border: "1px dashed var(--hairline)",
            borderRadius: "var(--radius)",
            color: "var(--text-tertiary)",
            fontSize: 14,
            textAlign: "center",
          }}
        >
          {q ? `No leads match "${q}".` : "No leads in this view."}
        </div>
      ) : (
        <RevealGroup
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 16,
          }}
        >
          {visible.map((l) => {
            const name =
              [l.firstName, l.lastName].filter(Boolean).join(" ") || "Anonymous";
            const initials =
              initialsOf(l.firstName ?? "?", l.lastName ?? "") || "??";
            return (
              <Reveal key={l.id}>
              <Link href={`/leads/${l.id}`}>
                <Card interactive>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      marginBottom: 12,
                    }}
                  >
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: "50%",
                        background: "var(--surface-2)",
                        border: "1px solid var(--hairline)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 13,
                        fontWeight: 500,
                      }}
                    >
                      {initials}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          color: "var(--text-primary)",
                          fontWeight: 500,
                          fontSize: 14,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {name}
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
                        {l.email ?? l.phone ?? "—"}
                      </div>
                    </div>
                    <StageChip stage={l.pipelineStage as PipelineStage} />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap",
                      marginBottom: 8,
                    }}
                  >
                    {l.therapyInterest && <Badge>{l.therapyInterest}</Badge>}
                    {l.campaign && <Badge>{l.campaign}</Badge>}
                    <Badge tone="neutral">{l.source}</Badge>
                  </div>
                  {l.notes && (
                    <div
                      style={{
                        color: "var(--text-secondary)",
                        fontSize: 13,
                        marginTop: 8,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {l.notes}
                    </div>
                  )}
                  <div
                    style={{
                      color: "var(--text-tertiary)",
                      fontSize: 11,
                      marginTop: 12,
                      paddingTop: 12,
                      borderTop: "1px solid var(--hairline)",
                    }}
                  >
                    {formatDate(l.createdAt)}
                  </div>
                </Card>
              </Link>
              </Reveal>
            );
          })}
        </RevealGroup>
      )}
    </>
  );
}
