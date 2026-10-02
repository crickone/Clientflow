"use client";
import type React from "react";
import type { WidgetMeta, WidgetRef } from "@/lib/dashboard/types";

export type GridItem = { ref: WidgetRef; title: string; href?: string; node: React.ReactNode };
export type CatalogEntry = Pick<WidgetMeta, "key" | "title" | "description" | "domain" | "sizes" | "defaultSize"> & {
  domainLabel: string;
};

export function DashboardGrid({ items }: { tabIndex: number; items: GridItem[]; catalog: CatalogEntry[] }) {
  return (
    <div className="dash-grid">
      {items.map((it, i) => (
        <div key={i} className={`dash-tile dash-span-${{ S: 1, M: 2, L: 3, XL: 4 }[it.ref.size]}`}>
          {it.node}
        </div>
      ))}
    </div>
  );
}
