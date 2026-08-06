"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Check, ChevronRight, Laptop, Mail, Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { Reveal, RevealGroup } from "@/components/motion/Reveal";
import { initialsOf } from "@/lib/utils";
import type { PurchasedDetail } from "@/lib/memberships";
import {
  assignMembershipAction,
  createMembershipAction,
  deleteMembershipAction,
  getPurchasedDetailAction,
  setClientMembershipStatusAction,
  updateMembershipAction,
} from "@/app/memberships/actions";

// ── shapes ────────────────────────────────────────────────────────────────────

export interface CatalogItem {
  id: number;
  name: string;
  category: string | null;
  description: string | null;
  priceCents: number;
  billingInterval: "week" | "month" | "year";
  billingCount: number;
  unlimitedSessions: boolean;
  sessionsQuantity: number;
  visibility: "all" | "private";
  joiningFeeCents: number;
  openAccess: boolean;
  priorityBooking: boolean;
  forSale: boolean;
  activePayments: number;
}
interface PurchasedItem {
  id: number;
  clientId: number;
  clientName: string;
  membershipId: number | null;
  membershipName: string;
  priceCents: number;
  status: string;
  startDate: string;
  nextBillingDate: string | null;
}
interface ClientLite {
  id: number;
  name: string;
}

// ── formatting ────────────────────────────────────────────────────────────────

function euros(cents: number) {
  return `€${(cents / 100).toLocaleString("en-IE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
function plural(n: number, unit: string) {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}
function durationLabel(m: { billingCount: number; billingInterval: string }) {
  return plural(m.billingCount, m.billingInterval);
}
function sessionsLabel(m: CatalogItem) {
  if (m.unlimitedSessions) return "Unlimited sessions";
  return `${plural(m.sessionsQuantity, "session")} per ${durationLabel(m)}`;
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IE", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "expired", label: "Expired" },
  { key: "cancelled", label: "Cancelled" },
];

// ── main view ─────────────────────────────────────────────────────────────────

export function MembershipsView({
  catalog,
  purchased,
  clients,
  today,
}: {
  catalog: CatalogItem[];
  purchased: PurchasedItem[];
  clients: ClientLite[];
  today: string;
}) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [detail, setDetail] = useState<PurchasedDetail | null>(null);
  const [, startDetail] = useTransition();

  const openDetail = (id: number) =>
    startDetail(async () => {
      const d = await getPurchasedDetailAction(id);
      if (d) setDetail(d);
      else toast.error("Could not load membership details.");
    });

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return purchased
      .filter((r) => (status === "all" ? true : r.status === status))
      .filter((r) =>
        query
          ? r.clientName.toLowerCase().includes(query) || r.membershipName.toLowerCase().includes(query)
          : true,
      );
  }, [purchased, q, status]);

  const openCreate = () => {
    setEditing(null);
    setSheetOpen(true);
  };
  const openEdit = (m: CatalogItem) => {
    setEditing(m);
    setSheetOpen(true);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      {/* catalog */}
      <div>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <h3 style={sectionTitle}>Plans</h3>
          <span style={{ marginLeft: 10, fontSize: 12, color: "var(--text-tertiary)" }}>
            {catalog.length}
          </span>
          <Button style={{ marginLeft: "auto" }} onClick={openCreate}>
            <Plus size={15} />
            Create membership
          </Button>
        </div>

        {catalog.length === 0 ? (
          <div style={emptyBox}>
            No memberships yet. Create your first recurring plan.
          </div>
        ) : (
          <RevealGroup
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: 14,
            }}
          >
            {catalog.map((m) => (
              <Reveal key={m.id}>
                <button onClick={() => openEdit(m)} style={{ ...card, width: "100%", height: "100%" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontSize: 15, fontWeight: 500, color: "var(--text-primary)" }}>{m.name}</div>
                    <div style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: 18 }}>
                      {euros(m.priceCents)}
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 6 }}>
                    <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{sessionsLabel(m)}</div>
                    <div style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>{durationLabel(m)}</div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: 14,
                    }}
                  >
                    {m.forSale ? (
                      <span style={pill("rgba(34,197,94,0.14)", "#22c55e")}>For sale</span>
                    ) : (
                      <span style={pill("rgba(255,255,255,0.06)", "var(--text-tertiary)")}>Not for sale</span>
                    )}
                    <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                      {plural(m.activePayments, "active payment")}
                    </span>
                  </div>
                  <ChevronRight
                    size={16}
                    style={{ position: "absolute", right: 12, bottom: 12, color: "var(--text-tertiary)" }}
                  />
                </button>
              </Reveal>
            ))}
          </RevealGroup>
        )}
      </div>

      {/* purchased */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <h3 style={sectionTitle}>Purchased memberships</h3>
          <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{filtered.length}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ width: 220 }}>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" />
            </div>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
              {STATUS_FILTERS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            <Button variant="outline" onClick={() => setAssignOpen(true)}>
              <UserPlus size={15} />
              Assign
            </Button>
          </div>
        </div>

        <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 720 }}>
              <div style={{ ...row, ...headRow }}>
                <div>Client</div>
                <div>Membership</div>
                <div>Status</div>
                <div>Start</div>
                <div>Next billing</div>
                <div style={{ textAlign: "right" }}>Actions</div>
              </div>
              {filtered.length === 0 && (
                <div style={{ padding: "26px 16px", textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>
                  No purchased memberships.
                </div>
              )}
              {filtered.map((r) => (
                <PurchasedRow key={r.id} r={r} onOpen={openDetail} onChanged={() => router.refresh()} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <MembershipSheet
        open={sheetOpen}
        editing={editing}
        onClose={() => setSheetOpen(false)}
        onSaved={() => {
          setSheetOpen(false);
          router.refresh();
        }}
      />

      <AssignDialog
        open={assignOpen}
        catalog={catalog.filter((m) => m.forSale)}
        clients={clients}
        today={today}
        onClose={() => setAssignOpen(false)}
        onAssigned={() => {
          setAssignOpen(false);
          router.refresh();
        }}
      />

      <PurchasedDetailSheet
        detail={detail}
        onClose={() => setDetail(null)}
        onReload={(id) => {
          openDetail(id);
          router.refresh();
        }}
      />
    </div>
  );
}

function PurchasedRow({
  r,
  onOpen,
  onChanged,
}: {
  r: PurchasedItem;
  onOpen: (id: number) => void;
  onChanged: () => void;
}) {
  const [pending, start] = useTransition();
  const set = (e: React.MouseEvent, status: "active" | "expired" | "cancelled") => {
    e.stopPropagation();
    start(async () => {
      await setClientMembershipStatusAction(r.id, status);
      onChanged();
    });
  };
  return (
    <div style={{ ...row, cursor: "pointer" }} onClick={() => onOpen(r.id)}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <Avatar initials={initials(r.clientName)} size={26} />
        <span style={clip}>{r.clientName}</span>
      </div>
      <div style={clip}>{r.membershipName}</div>
      <div>
        <StatusBadge status={r.status} />
      </div>
      <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>{fmtDate(r.startDate)}</div>
      <div style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>{fmtDate(r.nextBillingDate)}</div>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        {r.status === "active" ? (
          <button style={miniBtn} disabled={pending} onClick={(e) => set(e, "cancelled")}>
            Cancel
          </button>
        ) : (
          <button style={miniBtn} disabled={pending} onClick={(e) => set(e, "active")}>
            Reactivate
          </button>
        )}
      </div>
    </div>
  );
}

// ── purchased membership detail slide-over ────────────────────────────────────

function PurchasedDetailSheet({
  detail,
  onClose,
  onReload,
}: {
  detail: PurchasedDetail | null;
  onClose: () => void;
  onReload: (id: number) => void;
}) {
  const [pending, start] = useTransition();
  if (!detail) return null;
  const d = detail;

  const setStatus = (status: "active" | "expired" | "cancelled") =>
    start(async () => {
      await setClientMembershipStatusAction(d.id, status);
      onReload(d.id);
    });

  const creditBoxes = d.unlimitedSessions ? 0 : Math.max(d.sessionsQuantity, d.sessionsUsed);
  const over = d.sessionsUsed - d.sessionsQuantity;

  return (
    <Sheet open={!!detail} onOpenChange={(o) => !o && onClose()}>
      <SheetContent title="Purchased membership" width={460}>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {/* holder */}
          <div>
            <h3 style={detailH}>Membership holder</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
              <Avatar initials={initials(d.clientName)} size={40} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, color: "var(--text-primary)" }}>{d.clientName}</div>
                {d.clientEmail && (
                  <div style={{ fontSize: 12, color: "var(--text-tertiary)", display: "flex", alignItems: "center", gap: 5 }}>
                    <Mail size={12} />
                    {d.clientEmail}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* plan summary */}
          <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: "var(--text-primary)" }}>{d.membershipName}</div>
              <div style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: 18 }}>{euros(d.priceCents)}</div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 4, fontSize: 12.5, color: "var(--text-secondary)" }}>
              <span>{d.unlimitedSessions ? "Unlimited sessions" : `${plural(d.sessionsQuantity, "session")} per ${plural(d.billingCount, d.billingInterval)}`}</span>
              <span style={{ color: "var(--text-tertiary)" }}>{plural(d.billingCount, d.billingInterval)}</span>
            </div>
          </div>

          {/* billing + status */}
          <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={detailLabel}>Next billing</div>
                <div style={{ fontSize: 13, marginTop: 3 }}>{fmtDate(d.nextBillingDate)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={detailLabel}>Payment type</div>
                <div style={{ fontSize: 13, marginTop: 3, display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <Laptop size={13} /> Assigned manually
                </div>
              </div>
            </div>
            <div>
              <div style={detailLabel}>Status</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                <StatusBadge status={d.status} />
                {d.status === "active" ? (
                  <button style={miniBtn} disabled={pending} onClick={() => setStatus("cancelled")}>
                    Cancel
                  </button>
                ) : (
                  <button style={miniBtn} disabled={pending} onClick={() => setStatus("active")}>
                    Reactivate
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* sessions used */}
          <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 16 }}>
            <h3 style={detailH}>Sessions used</h3>
            <div style={{ fontSize: 12, color: "var(--text-tertiary)", margin: "6px 0 4px", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Calendar size={12} /> {fmtDate(d.periodStart)} – {fmtDate(d.periodEnd)}
            </div>
            {d.unlimitedSessions ? (
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                Unlimited — {d.sessionsUsed} session{d.sessionsUsed === 1 ? "" : "s"} attended this period.
              </div>
            ) : (
              <>
                <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>
                  {d.sessionsUsed} / {d.sessionsQuantity} credits used{over > 0 ? ` · ${over} over` : ""}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {Array.from({ length: creditBoxes }).map((_, i) => {
                    const used = i < d.sessionsUsed;
                    return (
                      <span
                        key={i}
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 6,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          border: used ? "1px solid var(--accent)" : "1px solid var(--hairline)",
                          background: used ? "var(--accent-soft)" : "transparent",
                          color: used ? "var(--accent-ink)" : "transparent",
                        }}
                      >
                        <Check size={14} />
                      </span>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* bookings */}
          <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 16 }}>
            <h3 style={detailH}>Bookings this period</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
              {d.bookings.length === 0 && (
                <div style={{ fontSize: 13, color: "var(--text-tertiary)" }}>No bookings in this period.</div>
              )}
              {d.bookings.map((b, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", border: "1px solid var(--hairline)", borderRadius: "var(--radius)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, ...clip }}>{b.sessionName}</div>
                    <div style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font-mono), monospace" }}>
                      {fmtDate(b.date)} · {b.startTime}
                    </div>
                  </div>
                  <span
                    style={pill(
                      b.status === "attended" ? "rgba(34,197,94,0.14)" : "rgba(255,255,255,0.06)",
                      b.status === "attended" ? "#22c55e" : "var(--text-tertiary)",
                    )}
                  >
                    {b.status === "attended" ? "Attended" : b.status === "no_show" ? "No-show" : "Booked"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", borderTop: "1px solid var(--hairline)", paddingTop: 14, lineHeight: 1.6 }}>
            Card payment methods and automatic billing arrive with the payments layer. Credits shown are
            derived from this client&apos;s bookings in the current cycle.
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── create / edit slide-over ──────────────────────────────────────────────────

function MembershipSheet({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: CatalogItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<"normal" | "bundle">("normal");

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"all" | "private">("all");
  const [price, setPrice] = useState("0");
  const [billingCount, setBillingCount] = useState(1);
  const [billingInterval, setBillingInterval] = useState<"week" | "month" | "year">("month");
  const [unlimited, setUnlimited] = useState(false);
  const [sessionsQuantity, setSessionsQuantity] = useState(1);
  const [joiningFee, setJoiningFee] = useState("0");
  const [openAccess, setOpenAccess] = useState(false);
  const [priorityBooking, setPriorityBooking] = useState(false);
  const [forSale, setForSale] = useState(true);

  const [seededId, setSeededId] = useState<number | "new" | null>(null);
  const key = editing ? editing.id : "new";
  if (open && seededId !== key) {
    setSeededId(key);
    setTab("normal");
    setName(editing?.name ?? "");
    setCategory(editing?.category ?? "");
    setDescription(editing?.description ?? "");
    setVisibility(editing?.visibility ?? "all");
    setPrice(editing ? (editing.priceCents / 100).toString() : "0");
    setBillingCount(editing?.billingCount ?? 1);
    setBillingInterval(editing?.billingInterval ?? "month");
    setUnlimited(editing?.unlimitedSessions ?? false);
    setSessionsQuantity(editing?.sessionsQuantity ?? 1);
    setJoiningFee(editing ? (editing.joiningFeeCents / 100).toString() : "0");
    setOpenAccess(editing?.openAccess ?? false);
    setPriorityBooking(editing?.priorityBooking ?? false);
    setForSale(editing?.forSale ?? true);
  }

  const priceCents = Math.round((parseFloat(price) || 0) * 100);
  const joiningFeeCents = Math.round((parseFloat(joiningFee) || 0) * 100);

  const submit = () => {
    if (!name.trim()) {
      toast.error("Give the membership a name.");
      return;
    }
    const payload = {
      name,
      category: category || null,
      description: description || null,
      priceCents,
      billingInterval,
      billingCount,
      unlimitedSessions: unlimited,
      sessionsQuantity,
      visibility,
      joiningFeeCents,
      openAccess,
      priorityBooking,
      forSale,
    };
    start(async () => {
      const res = editing
        ? await updateMembershipAction(editing.id, payload)
        : await createMembershipAction(payload);
      if (res.ok) {
        toast.success(editing ? "Membership updated." : "Membership created.");
        onSaved();
      } else {
        toast.error(res.error);
      }
    });
  };

  const remove = () => {
    if (!editing) return;
    start(async () => {
      await deleteMembershipAction(editing.id);
      toast.success("Membership removed.");
      onSaved();
    });
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={editing ? "Edit membership" : "Create membership"} width={480}>
        {/* tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--hairline)", marginBottom: 18 }}>
          {(["normal", "bundle"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1,
                padding: "10px 0",
                background: "transparent",
                border: "none",
                borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
                color: tab === t ? "var(--text-primary)" : "var(--text-tertiary)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                fontSize: 12,
                fontFamily: "var(--font-mono), monospace",
                cursor: "pointer",
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "bundle" ? (
          <div style={{ ...emptyBox, marginTop: 4 }}>
            Bundles (multiple memberships sold together) are coming with the billing layer.
            For now, create a single plan on the <strong>Normal</strong> tab.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <Label htmlFor="m-name">Name</Label>
              <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Inspire 3x per Week" autoFocus />
            </div>
            <div>
              <Label htmlFor="m-cat">Category</Label>
              <Input id="m-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Gym membership" />
            </div>
            <div>
              <Label htmlFor="m-desc">Description</Label>
              <Textarea id="m-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>

            <div>
              <Label htmlFor="m-vis">Who can see this membership?</Label>
              <select id="m-vis" value={visibility} onChange={(e) => setVisibility(e.target.value as "all")} style={selectStyle}>
                <option value="all">All clients</option>
                <option value="private">Just me (internal)</option>
              </select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <Label htmlFor="m-price">Price charged (€)</Label>
                <Input id="m-price" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="m-fee">Joining fee (€)</Label>
                <Input id="m-fee" type="number" min={0} step="0.01" value={joiningFee} onChange={(e) => setJoiningFee(e.target.value)} />
              </div>
            </div>

            <div>
              <Label>Billing cycle</Label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "var(--text-tertiary)" }}>Every</span>
                <Input
                  type="number"
                  min={1}
                  value={billingCount}
                  onChange={(e) => setBillingCount(Number(e.target.value))}
                  style={{ width: 80 }}
                />
                <select
                  value={billingInterval}
                  onChange={(e) => setBillingInterval(e.target.value as "month")}
                  style={{ ...selectStyle, width: 130 }}
                >
                  <option value="week">week(s)</option>
                  <option value="month">month(s)</option>
                  <option value="year">year(s)</option>
                </select>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 6 }}>
                Clients will be billed {euros(priceCents)} every {plural(billingCount, billingInterval)}.
              </div>
            </div>

            <Toggle
              on={unlimited}
              onChange={setUnlimited}
              label="Unlimited sessions"
              hint={`Unlimited bookings each ${plural(billingCount, billingInterval)}`}
            />
            {!unlimited && (
              <div>
                <Label htmlFor="m-sq">Sessions per cycle</Label>
                <Input
                  id="m-sq"
                  type="number"
                  min={1}
                  value={sessionsQuantity}
                  onChange={(e) => setSessionsQuantity(Number(e.target.value))}
                />
              </div>
            )}

            <Toggle on={openAccess} onChange={setOpenAccess} label="Open access" hint="Scan in without a prior booking" />
            <Toggle on={priorityBooking} onChange={setPriorityBooking} label="Priority booking" hint="Book further in advance than others" />
            <Toggle on={forSale} onChange={setForSale} label="For sale" hint="Available to assign / purchase" />

            <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center", paddingTop: 4 }}>
              {editing ? (
                <Button variant="ghost" onClick={remove} disabled={pending} aria-label="Delete membership">
                  <Trash2 size={14} />
                </Button>
              ) : (
                <span />
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <Button variant="ghost" onClick={onClose} disabled={pending}>
                  Cancel
                </Button>
                <Button onClick={submit} disabled={pending}>
                  {pending ? "Saving…" : editing ? "Save changes" : "Create"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── assign dialog ─────────────────────────────────────────────────────────────

function AssignDialog({
  open,
  catalog,
  clients,
  today,
  onClose,
  onAssigned,
}: {
  open: boolean;
  catalog: CatalogItem[];
  clients: ClientLite[];
  today: string;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [pending, start] = useTransition();
  const [membershipId, setMembershipId] = useState<number | "">("");
  const [clientId, setClientId] = useState<number | "">("");
  const [clientQ, setClientQ] = useState("");
  const [startDate, setStartDate] = useState(today);

  const [seeded, setSeeded] = useState(false);
  if (open && !seeded) {
    setSeeded(true);
    setMembershipId(catalog[0]?.id ?? "");
    setClientId("");
    setClientQ("");
    setStartDate(today);
  }
  if (!open && seeded) setSeeded(false);

  const matches = useMemo(() => {
    const query = clientQ.trim().toLowerCase();
    return clients.filter((c) => (query ? c.name.toLowerCase().includes(query) : true)).slice(0, 8);
  }, [clientQ, clients]);
  const selectedClient = clients.find((c) => c.id === clientId);

  const submit = () => {
    if (!membershipId) return toast.error("Pick a membership.");
    if (!clientId) return toast.error("Pick a client.");
    start(async () => {
      const res = await assignMembershipAction(Number(membershipId), Number(clientId), startDate);
      if (res.ok) {
        toast.success("Membership assigned.");
        onAssigned();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Assign membership" width={480}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <Label htmlFor="a-mem">Membership</Label>
            <select
              id="a-mem"
              value={membershipId}
              onChange={(e) => setMembershipId(e.target.value ? Number(e.target.value) : "")}
              style={selectStyle}
            >
              {catalog.length === 0 && <option value="">No memberships for sale</option>}
              {catalog.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — {euros(m.priceCents)} / {plural(m.billingCount, m.billingInterval)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="a-client">Client</Label>
            {selectedClient ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  border: "1px solid var(--hairline)",
                  borderRadius: "var(--radius)",
                }}
              >
                <Avatar initials={initials(selectedClient.name)} size={26} />
                <span style={{ fontSize: 13 }}>{selectedClient.name}</span>
                <button
                  onClick={() => setClientId("")}
                  style={{ marginLeft: "auto", background: "transparent", border: "none", color: "var(--text-tertiary)", cursor: "pointer" }}
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <Input id="a-client" value={clientQ} onChange={(e) => setClientQ(e.target.value)} placeholder="Search clients…" />
                {clientQ.trim() && (
                  <div style={{ marginTop: 6, border: "1px solid var(--hairline)", borderRadius: "var(--radius)", overflow: "hidden", maxHeight: 220, overflowY: "auto" }}>
                    {matches.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setClientId(c.id);
                          setClientQ("");
                        }}
                        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "8px 10px", background: "transparent", border: "none", borderBottom: "1px solid var(--hairline)", color: "var(--text-primary)", cursor: "pointer" }}
                      >
                        <Avatar initials={initials(c.name)} size={24} />
                        <span style={{ fontSize: 13 }}>{c.name}</span>
                      </button>
                    ))}
                    {matches.length === 0 && (
                      <div style={{ padding: "10px", fontSize: 13, color: "var(--text-tertiary)" }}>No matches.</div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div style={{ maxWidth: 200 }}>
            <Label htmlFor="a-start">Start date</Label>
            <Input id="a-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Assigning…" : "Assign"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── bits ──────────────────────────────────────────────────────────────────────

function Toggle({
  on,
  onChange,
  label,
  hint,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        textAlign: "left",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        padding: 0,
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: "var(--text-primary)" }}>{label}</div>
        {hint && <div style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>{hint}</div>}
      </div>
      <span
        style={{
          width: 40,
          height: 23,
          borderRadius: 999,
          background: on ? "var(--accent)" : "var(--surface-2)",
          border: "1px solid var(--hairline)",
          position: "relative",
          flexShrink: 0,
          transition: "background 0.15s var(--ease)",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: on ? 19 : 2,
            width: 17,
            height: 17,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 0.15s var(--ease)",
          }}
        />
      </span>
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    active: { label: "Active", bg: "rgba(34,197,94,0.14)", fg: "#22c55e" },
    expired: { label: "Expired", bg: "rgba(234,179,8,0.14)", fg: "#eab308" },
    cancelled: { label: "Cancelled", bg: "rgba(255,255,255,0.06)", fg: "var(--text-tertiary)" },
  };
  const m = map[status] ?? map.active;
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 10.5,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        fontFamily: "var(--font-mono), monospace",
        padding: "2px 8px",
        borderRadius: 5,
        background: m.bg,
        color: m.fg,
      }}
    >
      {m.label}
    </span>
  );
}

function initials(name: string) {
  const [a, b = ""] = name.trim().split(/\s+/);
  return initialsOf(a ?? "", b) || "?";
}
function pill(bg: string, fg: string): React.CSSProperties {
  return {
    display: "inline-block",
    fontSize: 10.5,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    fontFamily: "var(--font-mono), monospace",
    padding: "2px 8px",
    borderRadius: 5,
    background: bg,
    color: fg,
  };
}

const sectionTitle: React.CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-heading), sans-serif",
  fontSize: 16,
  textTransform: "uppercase",
  letterSpacing: "0.02em",
};
const detailH: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-secondary)",
  fontFamily: "var(--font-mono), monospace",
};
const detailLabel: React.CSSProperties = {
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-tertiary)",
  fontFamily: "var(--font-mono), monospace",
};
const card: React.CSSProperties = {
  position: "relative",
  textAlign: "left",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
  background: "var(--surface-1)",
  padding: "16px 16px 34px",
  cursor: "pointer",
};
const emptyBox: React.CSSProperties = {
  border: "1px dashed var(--hairline)",
  borderRadius: "var(--radius)",
  padding: "26px 20px",
  textAlign: "center",
  color: "var(--text-tertiary)",
  fontSize: 13,
  lineHeight: 1.6,
};
const row: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1.5fr 1.5fr 0.9fr 0.9fr 0.9fr 1fr",
  gap: 10,
  padding: "11px 16px",
  borderBottom: "1px solid var(--hairline)",
  alignItems: "center",
  fontSize: 13,
};
const headRow: React.CSSProperties = {
  background: "var(--surface-1)",
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-tertiary)",
  fontFamily: "var(--font-mono), monospace",
};
const clip: React.CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const miniBtn: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--hairline)",
  borderRadius: "var(--radius)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: 11,
  padding: "4px 10px",
};
const selectStyle: React.CSSProperties = {
  height: 38,
  padding: "0 12px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "var(--surface-1)",
  color: "var(--text-primary)",
  fontSize: 13,
  width: "100%",
};
