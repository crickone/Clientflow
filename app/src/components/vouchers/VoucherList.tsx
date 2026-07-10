"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, Ticket } from "lucide-react";
import type { Therapy, Voucher } from "@/lib/db/schema";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useVocab } from "@/components/providers/VocabProvider";
import { formatDate, formatEur } from "@/lib/utils";

interface Props {
  vouchers: Voucher[];
  therapyMap: Map<number, Therapy>;
}

export function VoucherList({ vouchers, therapyMap }: Props) {
  const vocab = useVocab();
  const [q, setQ] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  const filtered = useMemo(() => {
    if (!q.trim()) return vouchers;
    const needle = q.trim().toLowerCase();
    return vouchers.filter((v) =>
      [
        v.code,
        v.purchaserName,
        v.purchaserEmail ?? "",
        v.recipientName ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [vouchers, q]);

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
        <div style={{ position: "relative", flex: 1, maxWidth: 480 }}>
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
            placeholder="Search by code, name, or email…"
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
          {filtered.length} of {vouchers.length}
        </div>
      </div>

      {filtered.length === 0 ? (
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
          No vouchers match &ldquo;{q}&rdquo;.
        </div>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table>
            <thead>
              <tr>
                <th style={th}>Code</th>
                <th style={th}>Purchaser</th>
                <th style={th}>Recipient</th>
                <th style={th}>{vocab.service}</th>
                <th style={th}>Original</th>
                <th style={th}>Balance</th>
                <th style={th}>Expiry</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => {
                const t = v.therapyId ? therapyMap.get(v.therapyId) : null;
                const expired = v.expiryDate < today;
                const balance = v.balanceEur ?? v.valueEur;
                const empty = balance <= 0.01;
                const partiallyUsed =
                  balance > 0.01 && balance < v.valueEur - 0.01;
                const redeemable = !empty && !expired;
                return (
                  <tr key={v.id}>
                    <td
                      style={{
                        ...td,
                        fontFamily: "var(--font-heading)",
                        textTransform: "uppercase",
                      }}
                    >
                      {v.code}
                    </td>
                    <td style={td}>
                      <div>{v.purchaserName}</div>
                      {v.purchaserEmail && (
                        <div
                          style={{
                            color: "var(--text-tertiary)",
                            fontSize: 11,
                            marginTop: 2,
                          }}
                        >
                          {v.purchaserEmail}
                        </div>
                      )}
                    </td>
                    <td style={td}>{v.recipientName ?? "—"}</td>
                    <td style={td}>
                      {t ? (
                        <Badge colour={t.colourHex}>{t.name}</Badge>
                      ) : (
                        <Badge>Any</Badge>
                      )}
                    </td>
                    <td style={td}>{formatEur(v.valueEur)}</td>
                    <td
                      style={{
                        ...td,
                        color: empty
                          ? "var(--text-tertiary)"
                          : partiallyUsed
                            ? "#b45309"
                            : "var(--text-primary)",
                        fontWeight: 500,
                      }}
                    >
                      {formatEur(balance)}
                    </td>
                    <td style={td}>{formatDate(v.expiryDate)}</td>
                    <td style={td}>
                      {empty ? (
                        <Badge tone="green">Redeemed</Badge>
                      ) : expired ? (
                        <Badge tone="red">Expired</Badge>
                      ) : partiallyUsed ? (
                        <Badge tone="amber">Partial</Badge>
                      ) : (
                        <Badge tone="amber">Active</Badge>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      {redeemable ? (
                        <Link
                          href={`/appointments/new?voucher=${encodeURIComponent(v.code)}`}
                        >
                          <Button size="sm" variant="outline">
                            <Ticket size={13} />
                            Redeem
                          </Button>
                        </Link>
                      ) : (
                        <span
                          style={{
                            color: "var(--text-tertiary)",
                            fontSize: 12,
                          }}
                        >
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "14px 16px",
  fontSize: 11,
  fontWeight: 500,
  color: "var(--text-tertiary)",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  borderBottom: "1px solid var(--hairline)",
};
const td: React.CSSProperties = {
  padding: "14px 16px",
  borderBottom: "1px solid var(--hairline)",
  fontSize: 14,
  color: "var(--text-secondary)",
};
