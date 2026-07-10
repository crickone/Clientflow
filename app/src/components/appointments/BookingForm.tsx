"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Client, Package, PackageTemplate, Therapy } from "@/lib/db/schema";
import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { useVocab } from "@/components/providers/VocabProvider";

interface Props {
  therapies: Therapy[];
  clients: Client[];
  packageTemplates: PackageTemplate[];
  defaultClientId?: number;
  defaultDate?: string;
  defaultStartTime?: string;
  defaultVoucherCode?: string;
  defaultTherapyId?: number;
  /** When arriving via a voucher redemption, the recipient's name from the
   *  voucher is offered as a walk-in starting point. */
  defaultWalkInName?: string;
}

export function BookingForm({
  therapies,
  clients,
  packageTemplates,
  defaultClientId,
  defaultDate,
  defaultStartTime,
  defaultVoucherCode,
  defaultTherapyId,
  defaultWalkInName,
}: Props) {
  const router = useRouter();
  const vocab = useVocab();

  const splitName = (full?: string) => {
    if (!full) return ["", ""] as const;
    const parts = full.trim().split(/\s+/);
    return [parts[0] ?? "", parts.slice(1).join(" ")] as const;
  };
  const [defaultFirst, defaultLast] = splitName(defaultWalkInName);

  const [clientMode, setClientMode] = useState<"existing" | "walk_in">(
    defaultWalkInName && !defaultClientId ? "walk_in" : "existing",
  );
  const [clientId, setClientId] = useState<number | "">(defaultClientId ?? "");
  const [clientQ, setClientQ] = useState("");
  const [walkInFirstName, setWalkInFirstName] = useState(defaultFirst);
  const [walkInLastName, setWalkInLastName] = useState(defaultLast);
  const [walkInEmail, setWalkInEmail] = useState("");
  const [walkInPhone, setWalkInPhone] = useState("");
  const [therapyId, setTherapyId] = useState<number | "">(
    defaultTherapyId ?? "",
  );
  const [duration, setDuration] = useState(0);
  const [price, setPrice] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<
    "cash" | "card" | "package" | "voucher" | "bank_transfer"
  >(defaultVoucherCode ? "voucher" : "cash");
  const [secondaryPaymentMethod, setSecondaryPaymentMethod] = useState<
    "cash" | "card" | "bank_transfer"
  >("card");
  const [packageId, setPackageId] = useState<number | "">("");
  // "Sign up for a new package" at booking.
  const [packageMode, setPackageMode] = useState<"existing" | "new">("existing");
  const [newTemplateId, setNewTemplateId] = useState<number | "">("");
  const [newPkgName, setNewPkgName] = useState("");
  const [newPkgSessions, setNewPkgSessions] = useState(0);
  const [newPkgPrice, setNewPkgPrice] = useState(0);
  const [newPkgExpiry, setNewPkgExpiry] = useState("");
  const [newPkgPayMethod, setNewPkgPayMethod] = useState<
    "cash" | "card" | "bank_transfer"
  >("card");
  const [voucherCode, setVoucherCode] = useState(defaultVoucherCode ?? "");
  const [voucherInfo, setVoucherInfo] = useState<{
    state: "idle" | "valid" | "invalid" | "expired" | "empty";
    balance?: number;
  }>({ state: "idle" });
  const [activePackages, setActivePackages] = useState<Package[]>([]);
  const [submitting, setSubmitting] = useState(false);

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
  }, [clientQ, clients]);

  const therapyById = useMemo(
    () => new Map(therapies.map((t) => [t.id, t])),
    [therapies],
  );

  // Auto-fill duration + price from the selected therapy.
  useEffect(() => {
    if (typeof therapyId !== "number") {
      setDuration(0);
      setPrice(0);
      return;
    }
    const t = therapyById.get(therapyId);
    if (!t) return;
    setDuration(t.defaultDurationMinutes);
    setPrice(t.defaultPriceEur);
  }, [therapyId, therapyById]);

  // Fetch active packages for the client (filtered to the selected therapy)
  // when paymentMethod = package.
  useEffect(() => {
    if (paymentMethod !== "package" || !clientId || !therapyId) {
      setActivePackages([]);
      return;
    }
    fetch(`/api/packages?clientId=${clientId}&therapyId=${therapyId}`)
      .then((r) => r.json())
      .then((d: Package[]) => setActivePackages(d))
      .catch(() => setActivePackages([]));
  }, [paymentMethod, clientId, therapyId]);

  // Validate voucher code
  useEffect(() => {
    if (paymentMethod !== "voucher" || !voucherCode) {
      setVoucherInfo({ state: "idle" });
      return;
    }
    const id = setTimeout(() => {
      fetch(`/api/vouchers/${encodeURIComponent(voucherCode)}`)
        .then((r) => r.json())
        .then(
          (d: {
            ok: boolean;
            redeemable?: boolean;
            expired?: boolean;
            empty?: boolean;
            balanceEur?: number;
          }) => {
            if (!d.ok) setVoucherInfo({ state: "invalid" });
            else if (d.expired) setVoucherInfo({ state: "expired" });
            else if (d.empty) setVoucherInfo({ state: "empty" });
            else
              setVoucherInfo({
                state: "valid",
                balance: d.balanceEur ?? 0,
              });
          },
        )
        .catch(() => setVoucherInfo({ state: "invalid" }));
    }, 250);
    return () => clearTimeout(id);
  }, [voucherCode, paymentMethod]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (typeof therapyId !== "number" || duration <= 0) {
      toast.error(`Pick a ${vocab.service.toLowerCase()}.`);
      return;
    }
    if (clientMode === "existing" && !clientId) {
      toast.error(`Pick a ${vocab.member.toLowerCase()}.`);
      return;
    }
    if (clientMode === "walk_in" && !walkInFirstName.trim()) {
      toast.error(`Enter the walk-in ${vocab.member.toLowerCase()}'s first name.`);
      return;
    }
    if (
      paymentMethod === "package" &&
      packageMode === "new" &&
      !newTemplateId &&
      (!newPkgName.trim() || newPkgSessions <= 0 || !newPkgExpiry)
    ) {
      toast.error("Pick a package template or fill in the custom package details.");
      return;
    }
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    fd.delete("therapyIds");
    fd.append("therapyIds", String(therapyId));
    if (clientMode === "existing") {
      fd.set("clientId", String(clientId));
      fd.delete("walkInFirstName");
      fd.delete("walkInLastName");
      fd.delete("walkInEmail");
      fd.delete("walkInPhone");
    } else {
      fd.delete("clientId");
      fd.set("walkInFirstName", walkInFirstName.trim());
      fd.set("walkInLastName", walkInLastName.trim());
      fd.set("walkInEmail", walkInEmail.trim());
      fd.set("walkInPhone", walkInPhone.trim());
    }
    fd.set("durationMinutes", String(duration));
    fd.set("totalPriceEur", String(price));
    if (paymentMethod === "package") {
      fd.set("packageMode", packageMode);
      if (packageMode === "existing") {
        if (packageId) fd.set("packageId", String(packageId));
      } else {
        // New package — the session is covered (€0); the package price is
        // recorded as a separate sale by the API.
        fd.set("totalPriceEur", "0");
        fd.set("newPackagePaymentMethod", newPkgPayMethod);
        if (newTemplateId) {
          fd.set("newPackageTemplateId", String(newTemplateId));
        } else {
          fd.set("newPackageName", newPkgName.trim());
          fd.set("newPackageSessions", String(newPkgSessions));
          fd.set("newPackagePriceEur", String(newPkgPrice));
          fd.set("newPackageExpiry", newPkgExpiry);
        }
      }
    }
    if (paymentMethod === "voucher" && voucherCode) {
      fd.set("voucherCode", voucherCode);
      // If the voucher balance can't cover the session, the operator must
      // pick a secondary method for the remainder.
      if (
        voucherInfo.state === "valid" &&
        voucherInfo.balance != null &&
        voucherInfo.balance < price
      ) {
        fd.set("secondaryPaymentMethod", secondaryPaymentMethod);
      }
    }

    const res = await fetch("/api/appointments", {
      method: "POST",
      body: fd,
    });
    const data = await res.json();
    setSubmitting(false);
    if (!data.ok) {
      toast.error(data.error ?? `Could not book ${vocab.booking.toLowerCase()}.`);
      return;
    }
    toast.success(`${vocab.booking} booked.`);
    router.push(`/appointments/${data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Card>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <CardLabel style={{ marginBottom: 0 }}>{vocab.member}</CardLabel>
          <div
            role="tablist"
            style={{
              display: "inline-flex",
              background: "var(--surface-1)",
              border: "1px solid var(--hairline)",
              borderRadius: "var(--radius)",
              padding: 3,
              gap: 2,
            }}
          >
            {(
              [
                ["existing", "Existing"],
                ["walk_in", "Walk-in"],
              ] as const
            ).map(([value, label]) => {
              const active = clientMode === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setClientMode(value)}
                  style={{
                    padding: "5px 14px",
                    borderRadius: "var(--radius)",
                    fontSize: 12,
                    fontWeight: 500,
                    color: active
                      ? "var(--text-primary)"
                      : "var(--text-secondary)",
                    background: active ? "var(--bg)" : "transparent",
                    boxShadow: active ? "0 1px 3px -1px rgba(0,0,0,0.1)" : "none",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "all 0.15s var(--ease)",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {clientMode === "existing" ? (
          clientId ? (
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
                  return c ? (
                    <>
                      <div style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                        {c.firstName} {c.lastName}
                      </div>
                      <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>
                        {c.phone}
                      </div>
                    </>
                  ) : null;
                })()}
              </div>
              <Button variant="ghost" size="sm" type="button" onClick={() => setClientId("")}>
                Change
              </Button>
            </div>
          ) : (
            <>
              <Input
                placeholder={`Search ${vocab.member.toLowerCase()} by name, email, or phone…`}
                value={clientQ}
                onChange={(e) => setClientQ(e.target.value)}
              />
              <div
                style={{
                  marginTop: 10,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
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
                {filteredClients.length === 0 && (
                  <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>
                    No matches.
                  </div>
                )}
              </div>
            </>
          )
        ) : (
          <>
            <div
              style={{
                color: "var(--text-tertiary)",
                fontSize: 12,
                marginBottom: 12,
              }}
            >
              For voucher redemptions or one-off visits — we&rsquo;ll create a{" "}
              {vocab.member.toLowerCase()} record with whatever you fill in.
              Only first name is required.
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <div>
                <Label htmlFor="walkInFirstName">First name *</Label>
                <Input
                  id="walkInFirstName"
                  value={walkInFirstName}
                  onChange={(e) => setWalkInFirstName(e.target.value)}
                  required={clientMode === "walk_in"}
                />
              </div>
              <div>
                <Label htmlFor="walkInLastName">Last name</Label>
                <Input
                  id="walkInLastName"
                  value={walkInLastName}
                  onChange={(e) => setWalkInLastName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="walkInEmail">Email (optional)</Label>
                <Input
                  id="walkInEmail"
                  type="email"
                  value={walkInEmail}
                  onChange={(e) => setWalkInEmail(e.target.value)}
                  placeholder="name@example.com"
                />
              </div>
              <div>
                <Label htmlFor="walkInPhone">Phone (optional)</Label>
                <Input
                  id="walkInPhone"
                  value={walkInPhone}
                  onChange={(e) => setWalkInPhone(e.target.value)}
                  placeholder="+353 87 …"
                />
              </div>
            </div>
          </>
        )}
      </Card>

      <Card>
        <CardLabel>When</CardLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              type="date"
              name="date"
              defaultValue={defaultDate ?? new Date().toISOString().slice(0, 10)}
              required
            />
          </div>
          <div>
            <Label htmlFor="startTime">Start time</Label>
            <Input
              id="startTime"
              type="time"
              name="startTime"
              defaultValue={defaultStartTime ?? "09:00"}
              required
            />
          </div>
        </div>
      </Card>

      <Card>
        <CardLabel>{vocab.service}</CardLabel>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 8,
            marginBottom: 16,
          }}
        >
          {therapies.map((t) => {
            const checked = therapyId === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTherapyId(t.id)}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  border: `1px solid ${checked ? t.colourHex : "var(--hairline)"}`,
                  background: checked ? `${t.colourHex}14` : "transparent",
                  borderRadius: "var(--radius)",
                  cursor: "pointer",
                  color: "var(--text-primary)",
                  fontFamily: "inherit",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  transition: "all 0.15s var(--ease)",
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 500 }}>{t.name}</span>
                <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                  {t.defaultDurationMinutes} min · €{t.defaultPriceEur}
                </span>
              </button>
            );
          })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <Label>Duration (minutes)</Label>
            <Input
              type="number"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              min={0}
            />
          </div>
          <div>
            <Label>Total price (€)</Label>
            <Input
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
              min={0}
            />
          </div>
        </div>
      </Card>

      <Card>
        <CardLabel>Payment</CardLabel>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {(
            ["cash", "card", "package", "voucher", "bank_transfer"] as const
          ).map((m) => (
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
                  paymentMethod === m
                    ? "var(--text-primary)"
                    : "transparent",
                color:
                  paymentMethod === m
                    ? "var(--bg)"
                    : "var(--text-secondary)",
                cursor: "pointer",
                fontFamily: "inherit",
                textTransform: "capitalize",
                transition: "all 0.15s var(--ease)",
              }}
            >
              {m.replace("_", " ")}
            </button>
          ))}
        </div>
        <input type="hidden" name="paymentMethod" value={paymentMethod} />

        {paymentMethod === "package" && (
          <div>
            <div
              role="tablist"
              style={{
                display: "inline-flex",
                background: "var(--surface-1)",
                border: "1px solid var(--hairline)",
                borderRadius: "var(--radius)",
                padding: 3,
                gap: 2,
                marginBottom: 12,
              }}
            >
              {(
                [
                  ["existing", `Use existing ${vocab.plan.toLowerCase()}`],
                  ["new", `Sign up for new ${vocab.plan.toLowerCase()}`],
                ] as const
              ).map(([value, label]) => {
                const active = packageMode === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setPackageMode(value)}
                    style={{
                      padding: "5px 14px",
                      borderRadius: "var(--radius)",
                      fontSize: 12,
                      fontWeight: 500,
                      color: active ? "var(--text-primary)" : "var(--text-secondary)",
                      background: active ? "var(--bg)" : "transparent",
                      boxShadow: active ? "0 1px 3px -1px rgba(0,0,0,0.1)" : "none",
                      border: "none",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {packageMode === "existing" ? (
              activePackages.length === 0 ? (
                <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>
                  No active {vocab.plans.toLowerCase()} for this{" "}
                  {vocab.member.toLowerCase()}.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {activePackages.map((p) => {
                    const t = therapyById.get(p.therapyId);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPackageId(p.id)}
                        style={{
                          textAlign: "left",
                          padding: "10px 12px",
                          border: `1px solid ${
                            packageId === p.id ? "var(--text-primary)" : "var(--hairline)"
                          }`,
                          background: "transparent",
                          borderRadius: "var(--radius)",
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                            {p.packageName}
                          </span>
                          {t && <Badge colour={t.colourHex}>{t.name}</Badge>}
                        </div>
                        <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 4 }}>
                          {p.sessionsUsed}/{p.totalSessions} used · expires {p.expiryDate}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )
            ) : typeof therapyId !== "number" ? (
              <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>
                Pick a {vocab.service.toLowerCase()} first.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {packageTemplates
                    .filter((tpl) => tpl.therapyId === therapyId)
                    .map((tpl) => {
                      const active = newTemplateId === tpl.id;
                      return (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => {
                            setNewTemplateId(tpl.id);
                            setNewPkgName("");
                          }}
                          style={{
                            textAlign: "left",
                            padding: "10px 12px",
                            border: `1px solid ${
                              active ? "var(--text-primary)" : "var(--hairline)"
                            }`,
                            background: "transparent",
                            borderRadius: "var(--radius)",
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                              {tpl.name}
                            </span>
                            <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                              €{tpl.priceEur}
                            </span>
                          </div>
                          <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 4 }}>
                            {tpl.totalSessions} sessions · valid {tpl.validityMonths} months
                          </div>
                        </button>
                      );
                    })}
                  <button
                    type="button"
                    onClick={() => setNewTemplateId("")}
                    style={{
                      textAlign: "left",
                      padding: "10px 12px",
                      border: `1px solid ${
                        newTemplateId === "" ? "var(--text-primary)" : "var(--hairline)"
                      }`,
                      background: "transparent",
                      borderRadius: "var(--radius)",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      color: "var(--text-primary)",
                      fontSize: 14,
                    }}
                  >
                    Custom {vocab.plan.toLowerCase()}…
                  </button>
                </div>

                {newTemplateId === "" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <Label>{vocab.plan} name</Label>
                      <Input
                        value={newPkgName}
                        onChange={(e) => setNewPkgName(e.target.value)}
                        placeholder="e.g. 10-session pack"
                      />
                    </div>
                    <div>
                      <Label>Sessions</Label>
                      <Input
                        type="number"
                        min={1}
                        value={newPkgSessions}
                        onChange={(e) => setNewPkgSessions(Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <Label>Price (€)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
                        value={newPkgPrice}
                        onChange={(e) => setNewPkgPrice(Number(e.target.value))}
                      />
                    </div>
                    <div style={{ gridColumn: "1 / -1" }}>
                      <Label>Expiry</Label>
                      <Input
                        type="date"
                        value={newPkgExpiry}
                        onChange={(e) => setNewPkgExpiry(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                <div>
                  <Label>{vocab.plan} paid by</Label>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(["card", "cash", "bank_transfer"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setNewPkgPayMethod(m)}
                        style={{
                          padding: "6px 14px",
                          fontSize: 12,
                          borderRadius: "var(--radius)",
                          border: `1px solid ${
                            newPkgPayMethod === m ? "var(--text-primary)" : "var(--hairline)"
                          }`,
                          background: newPkgPayMethod === m ? "var(--text-primary)" : "transparent",
                          color: newPkgPayMethod === m ? "var(--bg)" : "var(--text-secondary)",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          textTransform: "capitalize",
                        }}
                      >
                        {m.replace("_", " ")}
                      </button>
                    ))}
                  </div>
                  <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 8 }}>
                    The session is covered by the {vocab.plan.toLowerCase()} (€0). The{" "}
                    {vocab.plan.toLowerCase()} price is recorded as the sale.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {paymentMethod === "voucher" && (
          <div>
            <Label>Voucher code</Label>
            <Input
              value={voucherCode}
              onChange={(e) => setVoucherCode(e.target.value)}
              placeholder="RCH-2026-XXXX"
            />
            {voucherCode && voucherInfo.state !== "idle" && (
              <div
                style={{
                  marginTop: 10,
                  fontSize: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {voucherInfo.state === "valid" && voucherInfo.balance != null ? (
                  <>
                    <div style={{ color: "#047857", fontWeight: 500 }}>
                      Valid voucher · €{voucherInfo.balance.toFixed(2)} balance
                    </div>
                    {price > 0 && voucherInfo.balance >= price && (
                      <div style={{ color: "var(--text-secondary)" }}>
                        Deduct €{price.toFixed(2)} → €
                        {(voucherInfo.balance - price).toFixed(2)} remaining
                        after this session
                      </div>
                    )}
                  </>
                ) : voucherInfo.state === "empty" ? (
                  <div style={{ color: "#b45309" }}>
                    Voucher fully redeemed (no balance left).
                  </div>
                ) : voucherInfo.state === "expired" ? (
                  <div style={{ color: "#dc2626" }}>Voucher has expired.</div>
                ) : (
                  <div style={{ color: "#dc2626" }}>Voucher not found.</div>
                )}
              </div>
            )}

            {/* Split-payment picker — shown when balance < session price */}
            {voucherInfo.state === "valid" &&
              voucherInfo.balance != null &&
              price > 0 &&
              voucherInfo.balance < price && (
                <div
                  style={{
                    marginTop: 14,
                    padding: 14,
                    border: "1px solid var(--hairline-strong)",
                    borderRadius: "var(--radius)",
                    background: "rgba(180, 83, 9, 0.04)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--text-primary)",
                      marginBottom: 6,
                    }}
                  >
                    Split payment
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      marginBottom: 12,
                    }}
                  >
                    Voucher covers €{voucherInfo.balance.toFixed(2)} of €
                    {price.toFixed(2)}. The remaining €
                    {(price - voucherInfo.balance).toFixed(2)} will be charged
                    by:
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(["card", "cash", "bank_transfer"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setSecondaryPaymentMethod(m)}
                        style={{
                          padding: "6px 14px",
                          fontSize: 12,
                          borderRadius: "var(--radius)",
                          border: `1px solid ${
                            secondaryPaymentMethod === m
                              ? "var(--text-primary)"
                              : "var(--hairline)"
                          }`,
                          background:
                            secondaryPaymentMethod === m
                              ? "var(--text-primary)"
                              : "transparent",
                          color:
                            secondaryPaymentMethod === m
                              ? "var(--bg)"
                              : "var(--text-secondary)",
                          cursor: "pointer",
                          fontFamily: "inherit",
                          textTransform: "capitalize",
                        }}
                      >
                        {m.replace("_", " ")}
                      </button>
                    ))}
                  </div>
                </div>
              )}
          </div>
        )}
      </Card>

      <Card>
        <CardLabel>Notes</CardLabel>
        <Textarea name="notes" placeholder="Anything we should know?" rows={3} />
      </Card>

      <input type="hidden" name="status" value="scheduled" />

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Booking…" : vocab.bookCta}
        </Button>
      </div>
    </form>
  );
}
