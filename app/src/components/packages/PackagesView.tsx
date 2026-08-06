"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calendar, ChevronRight, Mail, Minus, Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { Reveal, RevealGroup } from "@/components/motion/Reveal";
import { initialsOf } from "@/lib/utils";
import type { Pace, PurchasedPackageDetail } from "@/lib/sessionPackages";
import {
  adjustPackageCreditsAction,
  assignPackageAction,
  createPackageAction,
  deletePackageAction,
  getPurchasedPackageAction,
  setClientPackageStatusAction,
  updatePackageAction,
} from "@/app/session-packages/actions";

// ── shapes ────────────────────────────────────────────────────────────────────

export interface CatalogItem {
  id: number;
  name: string;
  category: string | null;
  description: string | null;
  priceCents: number;
  unlimitedSessions: boolean;
  sessionsQuantity: number;
  unlimitedDuration: boolean;
  expirationCount: number;
  expirationInterval: "week" | "month" | "year";
  singlePurchase: boolean;
  activateOnFirstBooking: boolean;
  autoRenewal: boolean;
  restrictToMembers: boolean;
  visibility: "all" | "private";
  openAccess: boolean;
  priorityBooking: boolean;
  forSale: boolean;
  activePayments: number;
}
interface PurchasedItem {
  id: number;
  clientId: number;
  clientName: string;
  packageName: string;
  priceCents: number;
  status: string;
  startDate: string;
  endDate: string | null;
  sessionsUsed: number;
  sessionsTotal: number;
  unlimitedSessions: boolean;
  activated: boolean;
  pace: Pace;
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
function sessionsLabel(m: { unlimitedSessions: boolean; sessionsQuantity: number }) {
  return m.unlimitedSessions ? "Unlimited sessions" : plural(m.sessionsQuantity, "session");
}
function durationLabel(m: {
  unlimitedDuration: boolean;
  expirationCount: number;
  expirationInterval: string;
}) {
  return m.unlimitedDuration ? "No expiry" : plural(m.expirationCount, m.expirationInterval);
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
  { key: "all", label: "All statuses" },
  { key: "active", label: "Active" },
  { key: "expired", label: "Expired" },
  { key: "cancelled", label: "Cancelled" },
];
const PACE_FILTERS = [
  { key: "all", label: "All usage" },
  { key: "ahead", label: "Ahead" },
  { key: "on_track", label: "On track" },
  { key: "behind", label: "Behind" },
];

// ── main view ─────────────────────────────────────────────────────────────────

export function PackagesView({
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
  const [pace, setPace] = useState("all");
  const [detail, setDetail] = useState<PurchasedPackageDetail | null>(null);
  const [, startDetail] = useTransition();

  const openDetail = (id: number) =>
    startDetail(async () => {
      const d = await getPurchasedPackageAction(id);
      if (d) setDetail(d);
      else toast.error("Could not load package details.");
    });

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return purchased
      .filter((r) => (status === "all" ? true : r.status === status))
      .filter((r) => (pace === "all" ? true : r.pace === pace))
      .filter((r) =>
        query
          ? r.clientName.toLowerCase().includes(query) || r.packageName.toLowerCase().includes(query)
          : true,
      );
  }, [purchased, q, status, pace]);

  const openCreate = () => {
    setEditing(null);
    setSheetOpen(true);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      {/* catalog */}
      <div>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <h3 style={sectionTitle}>Packages</h3>
          <span style={{ marginLeft: 10, fontSize: 12, color: "var(--text-tertiary)" }}>{catalog.length}</span>
          <Button style={{ marginLeft: "auto" }} onClick={openCreate}>
            <Plus size={15} />
            Create package
          </Button>
        </div>

        {catalog.length === 0 ? (
          <div style={emptyBox}>No packages yet. Create your first prepaid bundle.</div>
        ) : (
          <RevealGroup style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
            {catalog.map((m) => (
              <Reveal key={m.id}>
                <button onClick={() => { setEditing(m); setSheetOpen(true); }} style={{ ...card, width: "100%", height: "100%" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontSize: 15, fontWeight: 500, color: "var(--text-primary)" }}>{m.name}</div>
                    <div style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: 18 }}>{euros(m.priceCents)}</div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 6, fontSize: 12.5 }}>
                    <span style={{ color: "var(--text-tertiary)" }}>{m.category || "—"}</span>
                    <span style={{ color: "var(--text-secondary)" }}>{sessionsLabel(m)}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", marginTop: 4 }}>{durationLabel(m)}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    {m.singlePurchase && <span style={pill("rgba(255,255,255,0.06)", "var(--text-tertiary)")}>Single purchase</span>}
                    {m.activateOnFirstBooking && <span style={pill("rgba(255,255,255,0.06)", "var(--text-tertiary)")}>Activates on booking</span>}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
                    {m.forSale ? (
                      <span style={pill("rgba(34,197,94,0.14)", "#22c55e")}>For sale</span>
                    ) : (
                      <span style={pill("rgba(255,255,255,0.06)", "var(--text-tertiary)")}>Not for sale</span>
                    )}
                    <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{plural(m.activePayments, "active")}</span>
                  </div>
                  <ChevronRight size={16} style={{ position: "absolute", right: 12, bottom: 12, color: "var(--text-tertiary)" }} />
                </button>
              </Reveal>
            ))}
          </RevealGroup>
        )}
      </div>

      {/* purchased */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <h3 style={sectionTitle}>Purchased packages</h3>
          <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{filtered.length}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ width: 200 }}>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" />
            </div>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
              {STATUS_FILTERS.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
            <select value={pace} onChange={(e) => setPace(e.target.value)} style={selectStyle}>
              {PACE_FILTERS.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
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
            <div style={{ minWidth: 800 }}>
              <div style={{ ...row, ...headRow }}>
                <div>Client</div>
                <div>Package</div>
                <div>Status</div>
                <div>Start</div>
                <div>End</div>
                <div>Credits</div>
                <div style={{ textAlign: "right" }}>Usage</div>
              </div>
              {filtered.length === 0 && (
                <div style={{ padding: "26px 16px", textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>
                  No purchased packages.
                </div>
              )}
              {filtered.map((r) => (
                <div key={r.id} style={{ ...row, cursor: "pointer" }} onClick={() => openDetail(r.id)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <Avatar initials={initials(r.clientName)} size={26} />
                    <span style={clip}>{r.clientName}</span>
                  </div>
                  <div style={clip}>{r.packageName}</div>
                  <div><StatusBadge status={r.status} /></div>
                  <div style={cellMuted}>{fmtDate(r.startDate)}</div>
                  <div style={cellMuted}>{fmtDate(r.endDate)}</div>
                  <div style={{ fontFamily: "var(--font-mono), monospace", fontSize: 12.5 }}>
                    {r.unlimitedSessions ? "∞" : `${r.sessionsUsed} / ${r.sessionsTotal}`}
                  </div>
                  <div style={{ textAlign: "right" }}><PaceBadge pace={r.pace} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <PackageSheet
        open={sheetOpen}
        editing={editing}
        onClose={() => setSheetOpen(false)}
        onSaved={() => { setSheetOpen(false); router.refresh(); }}
      />

      <AssignDialog
        open={assignOpen}
        catalog={catalog.filter((m) => m.forSale)}
        clients={clients}
        today={today}
        onClose={() => setAssignOpen(false)}
        onAssigned={() => { setAssignOpen(false); router.refresh(); }}
      />

      <PackageDetailSheet
        detail={detail}
        onClose={() => setDetail(null)}
        onReload={(id) => { openDetail(id); router.refresh(); }}
      />
    </div>
  );
}

// ── create / edit slide-over ──────────────────────────────────────────────────

function PackageSheet({
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
  const [tab, setTab] = useState<"normal" | "program" | "course">("normal");

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"all" | "private">("all");
  const [restrictToMembers, setRestrictToMembers] = useState(false);
  const [price, setPrice] = useState("0");
  const [unlimitedSessions, setUnlimitedSessions] = useState(false);
  const [sessionsQuantity, setSessionsQuantity] = useState(12);
  const [unlimitedDuration, setUnlimitedDuration] = useState(false);
  const [expirationCount, setExpirationCount] = useState(4);
  const [expirationInterval, setExpirationInterval] = useState<"week" | "month" | "year">("week");
  const [singlePurchase, setSinglePurchase] = useState(false);
  const [activateOnFirstBooking, setActivateOnFirstBooking] = useState(false);
  const [autoRenewal, setAutoRenewal] = useState(false);
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
    setRestrictToMembers(editing?.restrictToMembers ?? false);
    setPrice(editing ? (editing.priceCents / 100).toString() : "0");
    setUnlimitedSessions(editing?.unlimitedSessions ?? false);
    setSessionsQuantity(editing?.sessionsQuantity ?? 12);
    setUnlimitedDuration(editing?.unlimitedDuration ?? false);
    setExpirationCount(editing?.expirationCount ?? 4);
    setExpirationInterval(editing?.expirationInterval ?? "week");
    setSinglePurchase(editing?.singlePurchase ?? false);
    setActivateOnFirstBooking(editing?.activateOnFirstBooking ?? false);
    setAutoRenewal(editing?.autoRenewal ?? false);
    setOpenAccess(editing?.openAccess ?? false);
    setPriorityBooking(editing?.priorityBooking ?? false);
    setForSale(editing?.forSale ?? true);
  }

  const priceCents = Math.round((parseFloat(price) || 0) * 100);

  const submit = () => {
    if (!name.trim()) return toast.error("Give the package a name.");
    const payload = {
      name,
      category: category || null,
      description: description || null,
      priceCents,
      unlimitedSessions,
      sessionsQuantity,
      unlimitedDuration,
      expirationCount,
      expirationInterval,
      singlePurchase,
      activateOnFirstBooking,
      autoRenewal,
      restrictToMembers,
      visibility,
      openAccess,
      priorityBooking,
      forSale,
    };
    start(async () => {
      const res = editing
        ? await updatePackageAction(editing.id, payload)
        : await createPackageAction(payload);
      if (res.ok) {
        toast.success(editing ? "Package updated." : "Package created.");
        onSaved();
      } else {
        toast.error(res.error);
      }
    });
  };

  const remove = () => {
    if (!editing) return;
    start(async () => {
      await deletePackageAction(editing.id);
      toast.success("Package removed.");
      onSaved();
    });
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={editing ? "Edit package" : "Create package"} width={480}>
        <div style={{ display: "flex", borderBottom: "1px solid var(--hairline)", marginBottom: 18 }}>
          {(["normal", "program", "course"] as const).map((t) => (
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

        {tab !== "normal" ? (
          <div style={{ ...emptyBox, marginTop: 4 }}>
            {tab === "program"
              ? "Programs (multi-week training plans with per-day workouts) are a larger builder — coming next."
              : "Courses (a fixed set of enrollable sessions with capacity) are coming next."}{" "}
            For now, build a standard bundle on the <strong>Normal</strong> tab.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <Label htmlFor="p-name">Name</Label>
              <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 8 Week Foundation" autoFocus />
            </div>
            <div>
              <Label htmlFor="p-cat">Category</Label>
              <Input id="p-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Gym" />
            </div>
            <div>
              <Label htmlFor="p-desc">Description</Label>
              <Textarea id="p-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>

            <div>
              <Label htmlFor="p-vis">Who can see this package?</Label>
              <select id="p-vis" value={visibility} onChange={(e) => setVisibility(e.target.value as "all")} style={selectStyle}>
                <option value="all">All clients</option>
                <option value="private">Just me (internal)</option>
              </select>
            </div>
            <Toggle on={restrictToMembers} onChange={setRestrictToMembers} label="Restrict to membership holders" hint="Only current members can buy" />

            <div>
              <Label htmlFor="p-price">Price charged (€)</Label>
              <Input id="p-price" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>

            <Toggle on={unlimitedSessions} onChange={setUnlimitedSessions} label="Unlimited sessions" hint="No credit cap" />
            {!unlimitedSessions && (
              <div>
                <Label htmlFor="p-sq">Session credits</Label>
                <Input id="p-sq" type="number" min={1} value={sessionsQuantity} onChange={(e) => setSessionsQuantity(Number(e.target.value))} />
              </div>
            )}

            <Toggle on={unlimitedDuration} onChange={setUnlimitedDuration} label="Unlimited duration" hint="Never expires" />
            {!unlimitedDuration && (
              <div>
                <Label>Expires after purchase</Label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Input type="number" min={1} value={expirationCount} onChange={(e) => setExpirationCount(Number(e.target.value))} style={{ width: 90 }} />
                  <select value={expirationInterval} onChange={(e) => setExpirationInterval(e.target.value as "week")} style={{ ...selectStyle, width: 130 }}>
                    <option value="week">week(s)</option>
                    <option value="month">month(s)</option>
                    <option value="year">year(s)</option>
                  </select>
                </div>
              </div>
            )}

            <Toggle on={singlePurchase} onChange={setSinglePurchase} label="Single purchase" hint="Only once per customer" />
            <Toggle on={activateOnFirstBooking} onChange={setActivateOnFirstBooking} label="Activate on first booking" hint="Validity starts when first used" />
            <Toggle on={autoRenewal} onChange={setAutoRenewal} label="Allow auto-renewal" hint="Re-buys when credits run out" />
            <Toggle on={openAccess} onChange={setOpenAccess} label="Open access" hint="Scan in without a prior booking" />
            <Toggle on={priorityBooking} onChange={setPriorityBooking} label="Priority booking" hint="Book further in advance" />
            <Toggle on={forSale} onChange={setForSale} label="For sale" hint="Available to assign / purchase" />

            <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center", paddingTop: 4 }}>
              {editing ? (
                <Button variant="ghost" onClick={remove} disabled={pending} aria-label="Delete package">
                  <Trash2 size={14} />
                </Button>
              ) : (
                <span />
              )}
              <div style={{ display: "flex", gap: 10 }}>
                <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
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
  const [packageId, setPackageId] = useState<number | "">("");
  const [clientId, setClientId] = useState<number | "">("");
  const [clientQ, setClientQ] = useState("");
  const [startDate, setStartDate] = useState(today);

  const [seeded, setSeeded] = useState(false);
  if (open && !seeded) {
    setSeeded(true);
    setPackageId(catalog[0]?.id ?? "");
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
    if (!packageId) return toast.error("Pick a package.");
    if (!clientId) return toast.error("Pick a client.");
    start(async () => {
      const res = await assignPackageAction(Number(packageId), Number(clientId), startDate);
      if (res.ok) {
        toast.success("Package assigned.");
        onAssigned();
      } else {
        toast.error(res.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Assign package" width={480}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <Label htmlFor="ap-pkg">Package</Label>
            <select id="ap-pkg" value={packageId} onChange={(e) => setPackageId(e.target.value ? Number(e.target.value) : "")} style={selectStyle}>
              {catalog.length === 0 && <option value="">No packages for sale</option>}
              {catalog.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — {euros(m.priceCents)} · {sessionsLabel(m)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="ap-client">Client</Label>
            {selectedClient ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: "1px solid var(--hairline)", borderRadius: "var(--radius)" }}>
                <Avatar initials={initials(selectedClient.name)} size={26} />
                <span style={{ fontSize: 13 }}>{selectedClient.name}</span>
                <button onClick={() => setClientId("")} style={{ marginLeft: "auto", background: "transparent", border: "none", color: "var(--text-tertiary)", cursor: "pointer" }}>Change</button>
              </div>
            ) : (
              <>
                <Input id="ap-client" value={clientQ} onChange={(e) => setClientQ(e.target.value)} placeholder="Search clients…" />
                {clientQ.trim() && (
                  <div style={{ marginTop: 6, border: "1px solid var(--hairline)", borderRadius: "var(--radius)", overflow: "hidden", maxHeight: 220, overflowY: "auto" }}>
                    {matches.map((c) => (
                      <button key={c.id} onClick={() => { setClientId(c.id); setClientQ(""); }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "8px 10px", background: "transparent", border: "none", borderBottom: "1px solid var(--hairline)", color: "var(--text-primary)", cursor: "pointer" }}>
                        <Avatar initials={initials(c.name)} size={24} />
                        <span style={{ fontSize: 13 }}>{c.name}</span>
                      </button>
                    ))}
                    {matches.length === 0 && <div style={{ padding: 10, fontSize: 13, color: "var(--text-tertiary)" }}>No matches.</div>}
                  </div>
                )}
              </>
            )}
          </div>

          <div style={{ maxWidth: 200 }}>
            <Label htmlFor="ap-start">Start date</Label>
            <Input id="ap-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button onClick={submit} disabled={pending}>{pending ? "Assigning…" : "Assign"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── detail slide-over ─────────────────────────────────────────────────────────

function PackageDetailSheet({
  detail,
  onClose,
  onReload,
}: {
  detail: PurchasedPackageDetail | null;
  onClose: () => void;
  onReload: (id: number) => void;
}) {
  const [pending, start] = useTransition();
  if (!detail) return null;
  const d = detail;

  const setStatus = (status: "active" | "expired" | "cancelled") =>
    start(async () => {
      await setClientPackageStatusAction(d.id, status);
      onReload(d.id);
    });
  const adjust = (delta: number) =>
    start(async () => {
      await adjustPackageCreditsAction(d.id, delta);
      onReload(d.id);
    });

  const remaining = d.unlimitedSessions ? null : Math.max(0, d.sessionsTotal - d.sessionsUsed);

  return (
    <Sheet open={!!detail} onOpenChange={(o) => !o && onClose()}>
      <SheetContent title="Purchased package" width={460}>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div>
            <h3 style={detailH}>Package holder</h3>
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

          <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: "var(--text-primary)" }}>{d.packageName}</div>
              <div style={{ fontFamily: "var(--font-heading), sans-serif", fontSize: 18 }}>{euros(d.priceCents)}</div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
              <StatusBadge status={d.status} />
              <PaceBadge pace={d.pace} />
              {!d.activated && <span style={pill("rgba(234,179,8,0.14)", "#eab308")}>Not activated</span>}
            </div>
          </div>

          {/* dates */}
          <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 16, display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={detailLabel}>Start</div>
              <div style={{ fontSize: 13, marginTop: 3 }}>{fmtDate(d.startDate)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={detailLabel}>Expires</div>
              <div style={{ fontSize: 13, marginTop: 3, display: "inline-flex", alignItems: "center", gap: 5 }}>
                <Calendar size={13} /> {fmtDate(d.endDate)}
              </div>
            </div>
          </div>

          {/* credits */}
          <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={detailH}>Credits used</h3>
              {!d.unlimitedSessions && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button style={roundBtn} disabled={pending || d.sessionsUsed <= 0} onClick={() => adjust(-1)} aria-label="Remove a credit">
                    <Minus size={14} />
                  </button>
                  <button style={roundBtn} disabled={pending} onClick={() => adjust(1)} aria-label="Add a credit">
                    <Plus size={14} />
                  </button>
                </div>
              )}
            </div>
            {d.unlimitedSessions ? (
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 8 }}>Unlimited — {d.sessionsUsed} used.</div>
            ) : (
              <>
                <div style={{ fontSize: 13, color: "var(--text-secondary)", margin: "8px 0" }}>
                  {d.sessionsUsed} / {d.sessionsTotal} used · {remaining} remaining
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {Array.from({ length: Math.max(d.sessionsTotal, d.sessionsUsed) }).map((_, i) => {
                    const used = i < d.sessionsUsed;
                    return (
                      <span
                        key={i}
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 6,
                          border: used ? "1px solid var(--accent)" : "1px solid var(--hairline)",
                          background: used ? "var(--accent-soft)" : "transparent",
                        }}
                      />
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div style={{ borderTop: "1px solid var(--hairline)", paddingTop: 14, display: "flex", gap: 10 }}>
            {d.status === "active" ? (
              <Button size="sm" variant="outline" onClick={() => setStatus("cancelled")} disabled={pending}>Cancel package</Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setStatus("active")} disabled={pending}>Reactivate</Button>
            )}
          </div>

          <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", borderTop: "1px solid var(--hairline)", paddingTop: 14, lineHeight: 1.6 }}>
            Credits are adjusted manually with +/− for now. When the payments layer lands, bookings will draw
            down credits automatically and card purchases will create packages here.
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── bits ──────────────────────────────────────────────────────────────────────

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: "var(--text-primary)" }}>{label}</div>
        {hint && <div style={{ fontSize: 11.5, color: "var(--text-tertiary)" }}>{hint}</div>}
      </div>
      <span style={{ width: 40, height: 23, borderRadius: 999, background: on ? "var(--accent)" : "var(--surface-2)", border: "1px solid var(--hairline)", position: "relative", flexShrink: 0, transition: "background 0.15s var(--ease)" }}>
        <span style={{ position: "absolute", top: 2, left: on ? 19 : 2, width: 17, height: 17, borderRadius: "50%", background: "#fff", transition: "left 0.15s var(--ease)" }} />
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
  return <span style={pill(m.bg, m.fg)}>{m.label}</span>;
}

function PaceBadge({ pace }: { pace: Pace }) {
  const map: Record<Pace, { label: string; bg: string; fg: string } | null> = {
    ahead: { label: "Ahead", bg: "rgba(59,130,246,0.16)", fg: "#60a5fa" },
    behind: { label: "Behind", bg: "rgba(234,179,8,0.16)", fg: "#eab308" },
    on_track: { label: "On track", bg: "rgba(34,197,94,0.14)", fg: "#22c55e" },
    na: null,
  };
  const m = map[pace];
  if (!m) return <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>—</span>;
  return <span style={pill(m.bg, m.fg)}>{m.label}</span>;
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
  gridTemplateColumns: "1.4fr 1.4fr 0.9fr 0.9fr 0.9fr 0.8fr 0.9fr",
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
const cellMuted: React.CSSProperties = { color: "var(--text-secondary)", fontSize: 12.5 };
const clip: React.CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
const roundBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: "50%",
  border: "1px solid var(--hairline)",
  background: "transparent",
  color: "var(--text-secondary)",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};
const selectStyle: React.CSSProperties = {
  height: 38,
  padding: "0 12px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "var(--surface-1)",
  color: "var(--text-primary)",
  fontSize: 13,
};
