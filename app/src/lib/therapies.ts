import fs from "node:fs";
import path from "node:path";

export type TherapyId = "hbot" | "ir" | "pemf";

export interface ChartConfig {
  type: "doughnut" | "bar";
  labels: string[];
  data: number[];
  color?: string;
}

export interface TherapyCharts {
  format: ChartConfig;
  advertisers: ChartConfig;
}

export interface TherapyTab {
  id: string;
  label: string;
}

export interface TherapyMeta {
  id: TherapyId;
  label: string;
  icon: string;
  fullName: string;
  accent: string;
  accentBg: string;
  totalAds: number;
  advertisers: number;
  scripts: number;
  subtitle: string;
  tabs: TherapyTab[];
  charts: TherapyCharts | null;
}

export interface TherapyData extends TherapyMeta {
  panes: Record<string, string>;
}

export interface IndexEntry {
  id: TherapyId;
  label: string;
  icon: string;
  accent: string;
  accentBg: string;
  totalAds: number;
  advertisers: number;
  scripts: number;
}

const DATA_DIR = path.join(process.cwd(), "public", "data");

export function loadTherapy(id: TherapyId): TherapyData {
  const file = path.join(DATA_DIR, `${id}.json`);
  return JSON.parse(fs.readFileSync(file, "utf8")) as TherapyData;
}

export function loadIndex(): { therapies: IndexEntry[] } {
  const file = path.join(DATA_DIR, "index.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export const THERAPY_IDS: TherapyId[] = ["hbot", "ir", "pemf"];
