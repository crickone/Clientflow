"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Gift, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import type { Client, PackageTemplate, Therapy } from "@/lib/db/schema";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { QuickAddClientForm } from "@/components/clients/QuickAddClientForm";
import { useVocab } from "@/components/providers/VocabProvider";
import {
  lookupVoucherAction,
  sellPackageAction,
  type VoucherLookupResult,
} from "@/app/packages/actions";

interface Props {
  clients: Client[];
  therapies: Therapy[];
  templates: PackageTemplate[];
  defaultClientId?: number;
}

function expiryFromMonths(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function SellPackageForm({
  clients: initialClients,
  therapies,
  templates,
  defaultClientId,
}: Props) {
  const vocab = useVocab();
  const [clients, setClients] = useState<Client[]>(initialClients);
  const [clientId, setClientId] = useState<number | "">(defaultClientId ?? "");
  const [clientQ, setClientQ] = useState("");
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [packageName, setPackageName] = useState<string>("");
  const [therapyId, setTherapyId] = useState<number | "">("");
  const [sessions, setSessions] = useState(10);
  const [price, setPrice] = useState(0);
  const [expiry, setExpiry] = useState(() => expiryFromMonths(12));
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "bank_transfer">("card");
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [voucherCode, setVoucherCode] = useState("");
  const [voucher, setVoucher] = useState<VoucherLookupResult | null>(null);
  const [voucherChecking, startVoucherCheck] = useTransition();

  const filteredClients = useMemo(() => {
    if (!clientQ) return clients.slice(0, 10);
    const q = clientQ.toLowerCase();
    return clients
      .filter((c) =>
        `${c.firstName} ${c.lastName} ${c.email ?? ""} ${c.phone}`
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 10);
  }, [clients, clientQ]);

  const selectedTemplate = templates.find((t) => t.id === templateId);
  const selectedTherapy = therapies.find((t) => t.id === therapyId);

  function applyTemplate(t: PackageTemplate) {
    setTemplateId(t.id);
    setPackageName(t.name);
    setTherapyId(t.therapyId);
    setSessions(t.totalSessions);
    setPrice(t.priceEur);
    setExpiry(expiryFromMonths(t.validityMonths));
  }

  function handleClientCreated(c: Client) {
    setClients((prev) => [c, ...prev]);
    setClientId(c.id);
    setClientQ("");
    setAddClientOpen(false);
    toast.success(`Added ${c.firstName} ${c.lastName}`);
  }

  function applyVoucher() {
    const code = voucherCode.trim();
    if (!code) {
      toast.error("Enter a voucher code first.");
      return;
    }
    if (!therapyId || !clientId) {
      toast.error(
        `Pick a ${vocab.plan.toLowerCase()} and ${vocab.member.toLowerCase()} before applying a voucher.`,
      );
      return;
    }
    startVoucherCheck(async () => {
      const res = await lookupVoucherAction(code, {
        clientId: Number(clientId),
        therapyId: Number(therapyId),
      });
      if (!res.ok) {
        toast.error(res.error ?? "Voucher could not be applied.");
        setVoucher(null);
        return;
      }
      setVoucher(res);
      toast.success(`Voucher applied: €${res.balanceEur} available.`);
    });
  }

  function clearVoucher() {
    setVoucher(null);
    setVoucherCode("");
  }

  const voucherApplied = voucher
    ? Math.min(voucher.balanceEur ?? 0, price)
    : 0;
  const dueNow = Math.max(0, price - voucherApplied);

  if (templates.length === 0) {
    return (
      <Card>
        <CardLabel>No {vocab.plan.toLowerCase()} templates yet</CardLabel>
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: 14,
            margin: "0 0 14px",
          }}
        >
          Define your {vocab.plans.toLowerCase()} in settings first —{" "}
          {vocab.service.toLowerCase()}, sessions, price, and validity — then
          come back here to sell them in one click.
        </p>
        <Link href="/settings/packages">
          <Button>Set up {vocab.plan.toLowerCase()} templates</Button>
        </Link>
      </Card>
    );
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!clientId) {
      toast.error(`Pick a ${vocab.member.toLowerCase()}.`);
      return;
    }
    if (!templateId || !therapyId) {
      toast.error(`Pick a pre-set ${vocab.plan.toLowerCase()}.`);
      return;
    }
    const therapy = therapies.find((t) => t.id === therapyId);
    const finalName =
      packageName.trim() ||
      (therapy ? `${therapy.name} · ${sessions} sessions` : `${sessions} sessions`);
    const fd = new FormData(e.currentTarget);
    fd.set("clientId", String(clientId));
    fd.set("therapyId", String(therapyId));
    fd.set("totalSessions", String(sessions));
    fd.set("pricePaidEur", String(price));
    fd.set("expiryDate", expiry);
    fd.set("paymentMethod", paymentMethod);
    fd.set("packageName", finalName);
    if (voucher && voucher.code) fd.set("voucherCode", voucher.code);
    try {
      await sellPackageAction(fd);
    } catch (err) {
      if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) return;
      toast.error(err instanceof Error ? err.message : "Sell failed.");
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Card>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <CardLabel style={{ marginBottom: 0 }}>Pre-set {vocab.plan.toLowerCase()}</CardLabel>
          <Link
            href="/settings/packages"
            style={{
              fontSize: 12,
              color: "var(--text-tertiary)",
              textDecoration: "underline",
            }}
          >
            Manage templates
          </Link>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 8,
          }}
        >
          {templates.map((t) => {
            const sel = templateId === t.id;
            const therapy = therapies.find((th) => th.id === t.therapyId);
            return (
              <button
                type="button"
                key={t.id}
                onClick={() => applyTemplate(t)}
                style={{
                  textAlign: "left",
                  padding: "12px 14px",
                  border: `1px solid ${
                    sel ? therapy?.colourHex ?? "var(--text-primary)" : "var(--hairline)"
                  }`,
                  background: sel
                    ? `${therapy?.colourHex ?? "#000"}14`
                    : "transparent",
                  borderRadius: "var(--radius)",
                  cursor: "pointer",
                  color: "var(--text-primary)",
                  fontFamily: "inherit",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {therapy && (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "var(--radius)",
                        background: therapy.colourHex,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{t.name}</span>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-tertiary)",
                    marginTop: 4,
                  }}
                >
                  {t.totalSessions} sessions · €{t.priceEur} · {t.validityMonths}-month validity
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardLabel>{vocab.member}</CardLabel>
        {clientId ? (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              {(() => {
                const c = clients.find((c) => c.id === clientId);
                return c ? `${c.firstName} ${c.lastName}` : "";
              })()}
            </div>
            <Button variant="ghost" size="sm" type="button" onClick={() => setClientId("")}>
              Change
            </Button>
          </div>
        ) : (
          <>
            <Input
              placeholder={`Search ${vocab.member.toLowerCase()}…`}
              value={clientQ}
              onChange={(e) => setClientQ(e.target.value)}
            />
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
              {filteredClients.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setClientId(c.id)}
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
              {clientQ && filteredClients.length === 0 && (
                <div
                  style={{
                    padding: "10px 12px",
                    color: "var(--text-tertiary)",
                    fontSize: 13,
                  }}
                >
                  No matches for &quot;{clientQ}&quot;.
                </div>
              )}
            </div>
            <div style={{ marginTop: 10 }}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAddClientOpen(true)}
              >
                <UserPlus size={14} />
                Add new {vocab.member.toLowerCase()}
              </Button>
            </div>
          </>
        )}
      </Card>

      {selectedTemplate && selectedTherapy && (
        <Card>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 14,
            }}
          >
            <CardLabel style={{ marginBottom: 0 }}>Details</CardLabel>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "var(--text-tertiary)",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "var(--radius)",
                  background: selectedTherapy.colourHex,
                }}
              />
              {selectedTherapy.name}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <div>
              <Label>Sessions</Label>
              <Input
                type="number"
                min={1}
                value={sessions}
                onChange={(e) => setSessions(Math.max(1, Number(e.target.value)))}
              />
            </div>
            <div>
              <Label>Price (€)</Label>
              <Input
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
              />
            </div>
            <div>
              <Label>Expiry</Label>
              <Input
                type="date"
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
              />
            </div>
          </div>
        </Card>
      )}

      {selectedTemplate && (
        <Card>
          <CardLabel>Gift voucher (optional)</CardLabel>
          {voucher ? (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 14px",
                border: "1px solid var(--hairline)",
                borderRadius: "var(--radius)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Gift size={16} color="var(--text-secondary)" />
                <div>
                  <div
                    style={{
                      color: "var(--text-primary)",
                      fontSize: 14,
                      fontWeight: 500,
                    }}
                  >
                    {voucher.code}
                  </div>
                  <div
                    style={{
                      color: "var(--text-tertiary)",
                      fontSize: 12,
                      marginTop: 2,
                    }}
                  >
                    €{voucherApplied} applied
                    {voucher.balanceEur != null && voucher.balanceEur > voucherApplied && (
                      <> · €{voucher.balanceEur - voucherApplied} will remain on voucher</>
                    )}
                  </div>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearVoucher}
              >
                <X size={14} />
                Remove
              </Button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <Input
                placeholder="Voucher code (e.g. ABCD-1234)"
                value={voucherCode}
                onChange={(e) => setVoucherCode(e.target.value.toUpperCase())}
                style={{ flex: 1 }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={applyVoucher}
                disabled={voucherChecking}
              >
                {voucherChecking ? "Checking…" : "Apply"}
              </Button>
            </div>
          )}
        </Card>
      )}

      <Card>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <CardLabel style={{ marginBottom: 0 }}>
            {voucherApplied > 0 ? "Remaining payment" : "Payment"}
          </CardLabel>
          {voucherApplied > 0 && (
            <div
              style={{
                fontSize: 13,
                color: "var(--text-secondary)",
                display: "flex",
                gap: 10,
                alignItems: "center",
              }}
            >
              <span>€{price} total</span>
              <span style={{ color: "var(--text-tertiary)" }}>−</span>
              <Badge>€{voucherApplied} voucher</Badge>
              <span style={{ color: "var(--text-tertiary)" }}>=</span>
              <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                €{dueNow} due
              </span>
            </div>
          )}
        </div>
        {dueNow === 0 ? (
          <div
            style={{
              color: "var(--text-tertiary)",
              fontSize: 13,
              padding: "10px 0",
            }}
          >
            Voucher covers the full price — no additional payment needed.
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["card", "cash", "bank_transfer"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setPaymentMethod(m)}
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  borderRadius: "var(--radius)",
                  border: `1px solid ${
                    paymentMethod === m ? "var(--text-primary)" : "var(--hairline)"
                  }`,
                  background:
                    paymentMethod === m ? "var(--text-primary)" : "transparent",
                  color: paymentMethod === m ? "var(--bg)" : "var(--text-secondary)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  textTransform: "capitalize",
                }}
              >
                {m.replace("_", " ")}
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardLabel>Notes</CardLabel>
        <Textarea name="notes" rows={2} />
      </Card>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button type="submit">Sell {vocab.plan.toLowerCase()}</Button>
      </div>

      <Dialog open={addClientOpen} onOpenChange={setAddClientOpen}>
        <DialogContent title={`Add new ${vocab.member.toLowerCase()}`} width={480}>
          <QuickAddClientForm
            initialSearch={clientQ}
            onCreated={handleClientCreated}
          />
        </DialogContent>
      </Dialog>
    </form>
  );
}

