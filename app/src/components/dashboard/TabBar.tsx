"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Binoculars,
  Heart,
  CalendarCheck,
  Copy,
  Cpu,
  Dumbbell,
  Globe,
  Images,
  LayoutDashboard,
  LayoutTemplate,
  Mail,
  Megaphone,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Settings2,
  Trash2,
  TrendingUp,
  Users,
  Wallet,
  ArrowLeft,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";

import {
  addTabAction,
  clearTeamDefaultAction,
  deleteTabAction,
  makeTeamDefaultAction,
  moveTabAction,
  renameTabAction,
  resetTabAction,
  setRangeAction,
  type ActionResult,
} from "@/app/dashboard/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import type { PresetIcon } from "@/lib/dashboard/presets";
import { MAX_CUSTOM_RANGE_DAYS, RANGE_LABELS, STORED_RANGE_KEYS, type RangeKey } from "@/lib/dashboard/range";
import type { TabSource } from "@/lib/dashboard/tabs";

export type TabBarProps = {
  tabs: { name: string; presetKey: string | null }[];
  active: number;
  rangeKey: RangeKey;
  rangeLabel: string;
  isAdmin: boolean;
  source: TabSource;
  presets: { key: string; name: string; description: string; icon: PresetIcon; count: number }[];
  custom?: { from: string; to: string };
};

const ICONS: Record<PresetIcon, LucideIcon> = {
  LayoutDashboard,
  TrendingUp,
  Megaphone,
  Mail,
  MessagesSquare,
  CalendarCheck,
  Dumbbell,
  Wallet,
  Images,
  Globe,
  Binoculars,
  Cpu,
  Heart,
};

export function TabBar({ tabs, active, rangeKey, rangeLabel, isAdmin, source, presets, custom }: TabBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<{ index: number; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const on = (e: Event) => setEditing(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener("dashboard:editing", on);
    return () => window.removeEventListener("dashboard:editing", on);
  }, []);

  function go(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null) sp.delete(k);
      else sp.set(k, v);
    }
    router.push(`${pathname}?${sp.toString()}`);
  }

  function act(fn: () => Promise<ActionResult>, after?: (r: Extract<ActionResult, { ok: true }>) => void) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error);
      after?.(r);
      router.refresh();
    });
  }

  function pickRange(key: string) {
    act(() => setRangeAction(active, key), () => go({ range: null, from: null, to: null }));
  }

  async function remove(index: number) {
    const ok = await confirm({ title: `Delete "${tabs[index].name}"?`, body: "This removes the tab and its layout.", destructive: true, confirmLabel: "Delete" });
    if (!ok) return;
    act(() => deleteTabAction(index), () => go({ tab: String(Math.max(0, index - 1)) }));
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div className="dash-tabs" role="tablist" aria-label="Dashboards" style={{ flex: 1, minWidth: 0 }}>
          {tabs.map((t, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center" }}>
              <button
                role="tab"
                aria-selected={i === active}
                onClick={() => go({ tab: String(i) })}
                disabled={editing}
                style={{
                  whiteSpace: "nowrap",
                  padding: "8px 12px",
                  borderRadius: "var(--radius)",
                  border: 0,
                  cursor: "pointer",
                  fontSize: 13.5,
                  fontWeight: 500,
                  background: i === active ? "var(--surface-2)" : "transparent",
                  color: i === active ? "var(--text-primary)" : "var(--text-secondary)",
                }}
              >
                {t.name}
              </button>
              {i === active && !editing && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button aria-label={`${t.name} options`} style={{ background: "none", border: 0, color: "var(--text-tertiary)", cursor: "pointer", display: "flex", padding: 4 }}>
                      <MoreHorizontal size={15} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={() => setRenaming({ index: i, name: t.name })}>
                      <Pencil size={14} /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => act(() => addTabAction({ kind: "duplicate", index: i }), (r) => go({ tab: String(r.index ?? i) }))}>
                      <Copy size={14} /> Duplicate
                    </DropdownMenuItem>
                    {i > 0 && (
                      <DropdownMenuItem onSelect={() => act(() => moveTabAction(i, i - 1), () => go({ tab: String(i - 1) }))}>
                        <ArrowLeft size={14} /> Move left
                      </DropdownMenuItem>
                    )}
                    {i < tabs.length - 1 && (
                      <DropdownMenuItem onSelect={() => act(() => moveTabAction(i, i + 1), () => go({ tab: String(i + 1) }))}>
                        <ArrowRight size={14} /> Move right
                      </DropdownMenuItem>
                    )}
                    {t.presetKey && (
                      <DropdownMenuItem
                        onSelect={async () => {
                          const ok = await confirm({ title: "Reset this tab to default?", body: "Your changes to this tab's widgets will be discarded.", destructive: true, confirmLabel: "Reset" });
                          if (ok) act(() => resetTabAction(i));
                        }}
                      >
                        <RotateCcw size={14} /> Reset to default
                      </DropdownMenuItem>
                    )}
                    {isAdmin && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={async () => {
                            const ok = await confirm({
                              title: "Make these tabs the team default?",
                              body: "Everyone who has not customised their dashboard, and every new team member, will start from your current tabs.",
                              confirmLabel: "Make team default",
                            });
                            if (ok) act(() => makeTeamDefaultAction());
                          }}
                        >
                          <Users size={14} /> Make team default
                        </DropdownMenuItem>
                        {source !== "platform" && (
                          <DropdownMenuItem
                            onSelect={async () => {
                              const ok = await confirm({ title: "Clear the team default?", body: "People who have not customised their dashboard will go back to the platform default.", destructive: true, confirmLabel: "Clear" });
                              if (ok) act(() => clearTeamDefaultAction());
                            }}
                          >
                            <LayoutTemplate size={14} /> Clear team default
                          </DropdownMenuItem>
                        )}
                      </>
                    )}
                    {tabs.length > 1 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => remove(i)}>
                          <Trash2 size={14} /> Delete tab
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ))}
          {!editing && (
            <button
              aria-label="Add a tab"
              onClick={() => setAdding(true)}
              style={{ background: "none", border: 0, color: "var(--text-tertiary)", cursor: "pointer", display: "flex", padding: "8px 10px" }}
            >
              <Plus size={16} />
            </button>
          )}
        </div>

        {!editing && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <DateRangePicker
              presets={STORED_RANGE_KEYS.map((k) => ({ key: k, label: RANGE_LABELS[k] }))}
              activeKey={rangeKey}
              label={rangeLabel}
              custom={custom}
              disabled={pending}
              maxDays={MAX_CUSTOM_RANGE_DAYS}
              onPreset={pickRange}
              onCustom={(f, t) => go({ range: "custom", from: f, to: t })}
            />
            <Button variant="ghost" size="sm" onClick={() => window.dispatchEvent(new Event("dashboard:customise"))}>
              <Settings2 size={14} /> Customise
            </Button>
          </div>
        )}
      </div>
      {error && !adding && !renaming && <div style={{ color: "#ef4444", fontSize: 13, marginTop: 8 }}>{error}</div>}

      {/* Add a tab */}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent title="Add a tab" description="Start from a preset, an empty tab, or a copy of this one." width={640}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
            {presets.map((p) => {
              const Icon = ICONS[p.icon];
              return (
                <button
                  key={p.key}
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    act(() => addTabAction({ kind: "preset", presetKey: p.key }), (r) => {
                      setAdding(false);
                      go({ tab: String(r.index ?? tabs.length) });
                    })
                  }
                  style={{ textAlign: "left", padding: 14, borderRadius: "var(--radius)", border: "1px solid var(--hairline)", background: "transparent", cursor: "pointer" }}
                >
                  <Icon size={18} color="var(--accent)" />
                  <div style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 500, marginTop: 8 }}>{p.name}</div>
                  <div style={{ color: "var(--text-tertiary)", fontSize: 12.5, marginTop: 4 }}>{p.description}</div>
                  <div style={{ color: "var(--text-tertiary)", fontSize: 11.5, marginTop: 8 }}>{p.count} widgets</div>
                </button>
              );
            })}
          </div>
          {error && <div role="alert" style={{ color: "#ef4444", fontSize: 13, marginTop: 12 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => act(() => addTabAction({ kind: "duplicate", index: active }), (r) => { setAdding(false); go({ tab: String(r.index ?? tabs.length) }); })}
            >
              <Copy size={14} /> Duplicate current
            </Button>
            <Button
              loading={pending}
              onClick={() => act(() => addTabAction({ kind: "blank" }), (r) => { setAdding(false); go({ tab: String(r.index ?? tabs.length) }); })}
            >
              <Plus size={14} /> Blank tab
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename */}
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent title="Rename tab" width={420}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!renaming) return;
              act(() => renameTabAction(renaming.index, renaming.name), () => setRenaming(null));
            }}
          >
            <Input
              autoFocus
              aria-label="Tab name"
              maxLength={40}
              value={renaming?.name ?? ""}
              onChange={(e) => setRenaming((r) => (r ? { ...r, name: e.target.value } : r))}
            />
            {error && <div role="alert" style={{ color: "#ef4444", fontSize: 13, marginTop: 10 }}>{error}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <Button type="submit" loading={pending}>Save</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

    </div>
  );
}
