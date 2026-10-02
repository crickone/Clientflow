"use client";
import type { PresetIcon } from "@/lib/dashboard/presets";
import type { RangeKey } from "@/lib/dashboard/range";
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

export function TabBar(props: TabBarProps) {
  return <div className="dash-tabs">{props.tabs.map((t, i) => <span key={i}>{t.name}</span>)}</div>;
}
