"use client";

import { useMemo, useState } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import type { Client } from "@/lib/db/schema";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { QuickAddClientForm } from "@/components/clients/QuickAddClientForm";
import { useVocab } from "@/components/providers/VocabProvider";

interface Props {
  clients: Client[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onClientCreated: (c: Client) => void;
  placeholder?: string;
}

export function ClientPicker({
  clients,
  selectedId,
  onSelect,
  onClientCreated,
  placeholder,
}: Props) {
  const vocab = useVocab();
  const ph = placeholder ?? `Search ${vocab.member.toLowerCase()}…`;
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!q) return clients.slice(0, 10);
    const needle = q.toLowerCase();
    return clients
      .filter((c) =>
        `${c.firstName} ${c.lastName} ${c.email ?? ""} ${c.phone}`
          .toLowerCase()
          .includes(needle),
      )
      .slice(0, 10);
  }, [clients, q]);

  const selected = clients.find((c) => c.id === selectedId);

  if (selected) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontWeight: 500, color: "var(--text-primary)" }}>
            {selected.firstName} {selected.lastName}
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-tertiary)",
              marginTop: 2,
            }}
          >
            {selected.phone}
            {selected.email ? ` · ${selected.email}` : ""}
          </div>
        </div>
        <Button variant="ghost" size="sm" type="button" onClick={() => onSelect(null)}>
          Change
        </Button>
      </div>
    );
  }

  return (
    <>
      <Input
        placeholder={ph}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div
        style={{
          marginTop: 10,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {filtered.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            style={{
              textAlign: "left",
              padding: "10px 12px",
              background: "transparent",
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius)",
              cursor: "pointer",
              color: "var(--text-primary)",
              fontSize: 14,
              fontFamily: "inherit",
            }}
          >
            {c.firstName} {c.lastName}
            <span style={{ color: "var(--text-tertiary)", marginLeft: 8 }}>
              {c.phone}
            </span>
          </button>
        ))}
        {q && filtered.length === 0 && (
          <div
            style={{
              padding: "10px 12px",
              color: "var(--text-tertiary)",
              fontSize: 13,
            }}
          >
            No matches for &quot;{q}&quot;.
          </div>
        )}
      </div>
      <div style={{ marginTop: 10 }}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAddOpen(true)}
        >
          <UserPlus size={14} />
          Add new {vocab.member.toLowerCase()}
        </Button>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent title={`Add new ${vocab.member.toLowerCase()}`} width={480}>
          <QuickAddClientForm
            initialSearch={q}
            onCreated={(c) => {
              onClientCreated(c);
              setAddOpen(false);
              setQ("");
              toast.success(`Added ${c.firstName} ${c.lastName}`);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
