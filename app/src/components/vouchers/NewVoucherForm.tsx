"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { Client, Therapy } from "@/lib/db/schema";
import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import { ClientPicker } from "@/components/clients/ClientPicker";
import { useVocab } from "@/components/providers/VocabProvider";
import { createVoucherAction } from "@/app/vouchers/actions";

interface Props {
  clients: Client[];
  therapies: Therapy[];
}

type Mode = "client" | "guest";

export function NewVoucherForm({ clients: initialClients, therapies }: Props) {
  const vocab = useVocab();
  const [clients, setClients] = useState<Client[]>(initialClients);

  const [purchaserMode, setPurchaserMode] = useState<Mode>("client");
  const [purchaserClientId, setPurchaserClientId] = useState<number | null>(null);

  const [recipientMode, setRecipientMode] = useState<Mode>("guest");
  const [recipientClientId, setRecipientClientId] = useState<number | null>(null);

  function handleClientCreated(c: Client) {
    setClients((prev) => [c, ...prev]);
  }

  const purchaserClient = clients.find((c) => c.id === purchaserClientId);
  const recipientClient = clients.find((c) => c.id === recipientClientId);

  const defaultExpiry = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  }, []);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    if (purchaserMode === "client") {
      if (!purchaserClient) {
        toast.error(`Pick a ${vocab.member.toLowerCase()} for the purchaser.`);
        return;
      }
      fd.set("purchaserClientId", String(purchaserClient.id));
      fd.set(
        "purchaserName",
        `${purchaserClient.firstName} ${purchaserClient.lastName}`,
      );
      fd.set("purchaserEmail", purchaserClient.email ?? "");
    }

    if (recipientMode === "client") {
      if (!recipientClient) {
        toast.error(`Pick a ${vocab.member.toLowerCase()} for the recipient.`);
        return;
      }
      fd.set("recipientClientId", String(recipientClient.id));
      fd.set(
        "recipientName",
        `${recipientClient.firstName} ${recipientClient.lastName}`,
      );
    } else {
      fd.delete("recipientClientId");
    }

    void createVoucherAction(fd);
  }

  return (
    <form
      onSubmit={submit}
      style={{ display: "flex", flexDirection: "column", gap: 24 }}
    >
      <Card>
        <CardLabel>Purchaser</CardLabel>
        <ModeToggle value={purchaserMode} onChange={setPurchaserMode} />
        {purchaserMode === "client" ? (
          <ClientPicker
            clients={clients}
            selectedId={purchaserClientId}
            onSelect={setPurchaserClientId}
            onClientCreated={(c) => {
              handleClientCreated(c);
              setPurchaserClientId(c.id);
            }}
          />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <Label htmlFor="purchaserName">Name</Label>
              <Input id="purchaserName" name="purchaserName" required />
            </div>
            <div>
              <Label htmlFor="purchaserEmail">Email</Label>
              <Input id="purchaserEmail" name="purchaserEmail" type="email" />
            </div>
          </div>
        )}
      </Card>

      <Card>
        <CardLabel>Recipient</CardLabel>
        <p
          style={{
            fontSize: 12,
            color: "var(--text-tertiary)",
            margin: "0 0 12px",
          }}
        >
          If you link a {vocab.member.toLowerCase()} here, only that{" "}
          {vocab.member.toLowerCase()} can redeem the voucher.
        </p>
        <ModeToggle
          value={recipientMode}
          onChange={setRecipientMode}
          labels={{ client: `Existing ${vocab.member.toLowerCase()}`, guest: "Just a name" }}
        />
        {recipientMode === "client" ? (
          <ClientPicker
            clients={clients}
            selectedId={recipientClientId}
            onSelect={setRecipientClientId}
            onClientCreated={(c) => {
              handleClientCreated(c);
              setRecipientClientId(c.id);
            }}
          />
        ) : (
          <>
            <Label htmlFor="recipientName">Recipient name (optional)</Label>
            <Input id="recipientName" name="recipientName" />
          </>
        )}
      </Card>

      <Card>
        <CardLabel>Voucher</CardLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <Label htmlFor="therapyId">{vocab.service}</Label>
            <select
              id="therapyId"
              name="therapyId"
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
              defaultValue=""
            >
              <option value="">Any {vocab.service.toLowerCase()}</option>
              {therapies.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="valueEur">Value (€)</Label>
            <Input
              id="valueEur"
              name="valueEur"
              type="number"
              step="0.01"
              min={0}
              required
              defaultValue={100}
            />
          </div>
          <div>
            <Label htmlFor="expiryDate">Expiry</Label>
            <Input
              id="expiryDate"
              name="expiryDate"
              type="date"
              defaultValue={defaultExpiry}
              required
            />
          </div>
        </div>
      </Card>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>
          A unique code will be generated automatically.
        </span>
        <Button type="submit">Create voucher</Button>
      </div>
    </form>
  );
}

function ModeToggle({
  value,
  onChange,
  labels,
}: {
  value: Mode;
  onChange: (m: Mode) => void;
  labels?: { client: string; guest: string };
}) {
  const vocab = useVocab();
  const resolved = labels ?? {
    client: `Existing ${vocab.member.toLowerCase()}`,
    guest: "New person / guest",
  };
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
      {(["client", "guest"] as const).map((m) => (
        <button
          type="button"
          key={m}
          onClick={() => onChange(m)}
          style={{
            padding: "8px 14px",
            borderRadius: "var(--radius)",
            fontSize: 13,
            border: `1px solid ${
              value === m ? "var(--text-primary)" : "var(--hairline)"
            }`,
            background: value === m ? "var(--text-primary)" : "transparent",
            color: value === m ? "var(--bg)" : "var(--text-secondary)",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {resolved[m]}
        </button>
      ))}
    </div>
  );
}
