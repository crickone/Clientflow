"use client";

import { useState, useMemo } from "react";
import { Search, Filter, X } from "lucide-react";
import type { ConditionRow, Therapy } from "@/lib/training/content";

const ALL_THERAPIES: Therapy[] = ["HBOT", "INFRARED", "PEMF", "MASSAGE"];

const ACCENT_BY_THERAPY: Record<Therapy, string> = {
  HBOT: "var(--accent-hbot)",
  INFRARED: "var(--accent-ir)",
  PEMF: "var(--accent-pemf)",
  MASSAGE: "var(--text-secondary)",
};

interface Props {
  conditions: ConditionRow[];
  categories: string[];
}

export function LookupClient({ conditions, categories }: Props) {
  const [query, setQuery] = useState("");
  const [therapyFilter, setTherapyFilter] = useState<Therapy | "ALL">("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string | "ALL">("ALL");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conditions.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q) && !c.leadWith.toLowerCase().includes(q)) return false;
      if (therapyFilter !== "ALL" && !c.therapies.includes(therapyFilter)) return false;
      if (categoryFilter !== "ALL" && c.category !== categoryFilter) return false;
      return true;
    });
  }, [conditions, query, therapyFilter, categoryFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, ConditionRow[]>();
    filtered.forEach((c) => {
      if (!map.has(c.category)) map.set(c.category, []);
      map.get(c.category)!.push(c);
    });
    return Array.from(map.entries());
  }, [filtered]);

  const clear = () => { setQuery(""); setTherapyFilter("ALL"); setCategoryFilter("ALL"); };
  const anyFilter = query || therapyFilter !== "ALL" || categoryFilter !== "ALL";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Search + filters */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 280px", minWidth: 240 }}>
          <Search size={15} strokeWidth={1.75} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)", pointerEvents: "none" }} />
          <input
            className="search-box"
            placeholder="Type a condition or symptom…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ paddingLeft: 42 }}
          />
        </div>

        <FilterChip
          label="Therapy"
          value={therapyFilter}
          options={[{ v: "ALL", l: "All therapies" }, ...ALL_THERAPIES.map((t) => ({ v: t, l: t }))]}
          onChange={(v) => setTherapyFilter(v as Therapy | "ALL")}
        />
        <FilterChip
          label="Category"
          value={categoryFilter}
          options={[{ v: "ALL", l: "All categories" }, ...categories.map((c) => ({ v: c, l: c }))]}
          onChange={(v) => setCategoryFilter(v)}
        />
        {anyFilter && (
          <button
            onClick={clear}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              fontSize: 13,
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius)",
              background: "var(--bg)",
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            <X size={13} /> Clear
          </button>
        )}
      </div>

      <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
        {filtered.length} of {conditions.length} conditions
      </div>

      {/* Results */}
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        {grouped.length === 0 && (
          <div style={{ padding: "60px 20px", textAlign: "center", color: "var(--text-tertiary)", fontSize: 14, border: "1px dashed var(--hairline)", borderRadius: "var(--radius)" }}>
            No conditions match. Try a different search or clear the filters.
          </div>
        )}
        {grouped.map(([category, rows]) => (
          <section key={category}>
            <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-tertiary)", fontWeight: 500, marginBottom: 12 }}>
              {category}
            </div>
            <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", overflow: "hidden", boxShadow: "var(--shadow-1)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--surface-1)" }}>
                    <th style={th()}>Condition</th>
                    <th style={th()}>Therapies</th>
                    <th style={th()}>Lead with</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={row.name} style={{ borderTop: i === 0 ? "none" : "1px solid var(--hairline)" }}>
                      <td style={td({ fontWeight: 500, color: "var(--text-primary)", minWidth: 200 })}>
                        {row.name}
                      </td>
                      <td style={td({ minWidth: 200 })}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {ALL_THERAPIES.map((t) => {
                            const active = row.therapies.includes(t);
                            const lead = row.therapies[0] === t;
                            return (
                              <span
                                key={t}
                                title={active ? (lead ? `${t} — lead with` : t) : `${t} — not recommended`}
                                style={{
                                  fontSize: 10.5,
                                  letterSpacing: "0.06em",
                                  padding: "3px 9px",
                                  borderRadius: "var(--radius)",
                                  border: `1px solid ${active ? ACCENT_BY_THERAPY[t] : "var(--hairline)"}`,
                                  background: active ? (lead ? ACCENT_BY_THERAPY[t] : "transparent") : "transparent",
                                  color: active ? (lead ? "var(--bg)" : ACCENT_BY_THERAPY[t]) : "var(--text-tertiary)",
                                  fontWeight: lead ? 600 : 500,
                                  opacity: active ? 1 : 0.4,
                                }}
                              >
                                {t}
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td style={td({ color: "var(--text-secondary)", lineHeight: 1.55 })}>
                        {row.leadWith}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 12, color: "var(--text-secondary)", padding: "12px 0", borderTop: "1px solid var(--hairline)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: "var(--radius)", background: "var(--text-primary)", display: "inline-block" }} />
          Filled pill = primary therapy (lead with this)
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: "var(--radius)", border: "1px solid var(--text-secondary)", display: "inline-block" }} />
          Outline = recommended adjunct
        </span>
      </div>
    </div>
  );
}

function FilterChip({ label, value, options, onChange }: { label: string; value: string; options: { v: string; l: string }[]; onChange: (v: string) => void }) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 6px 8px 14px",
        background: "var(--bg)",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        fontSize: 13,
        color: "var(--text-secondary)",
        cursor: "pointer",
      }}
    >
      <Filter size={13} strokeWidth={1.75} />
      <span style={{ color: "var(--text-tertiary)" }}>{label}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          border: "none",
          background: "transparent",
          color: "var(--text-primary)",
          fontSize: 13,
          padding: "0 8px",
          outline: "none",
          cursor: "pointer",
        }}
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>{o.l}</option>
        ))}
      </select>
    </label>
  );
}

function th(): React.CSSProperties {
  return {
    textAlign: "left",
    padding: "12px 16px",
    fontSize: 11,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "var(--text-tertiary)",
    fontWeight: 500,
    borderBottom: "1px solid var(--hairline)",
  };
}

function td(extra: React.CSSProperties): React.CSSProperties {
  return {
    padding: "14px 16px",
    fontSize: 14,
    verticalAlign: "top",
    ...extra,
  };
}
