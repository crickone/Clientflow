/**
 * The GoHighLevel import's shapes shared by the route, the store and the
 * screen. Types only. None of them carries the staff-only medical note
 * except ImportedPersonView, which only the lead and client pages read.
 */
import type { DryRunRow, PlanTotals } from "./plan";

export interface StaffOption {
  userId: number;
  name: string;
}

/** One GoHighLevel user from the files, and who their leads go to here. */
export interface AssigneeRow {
  ghlName: string;
  people: number;
  /** The automatic match by name, or null. */
  matchedUserId: number | null;
  /** Who it is now (the operator's pick, else the match); null = the default assignee. */
  userId: number | null;
}

export interface DryRunData {
  totals: PlanTotals;
  rows: DryRunRow[];
  assignees: AssigneeRow[];
  staff: StaffOption[];
  defaultAssigneeName: string | null;
  exportDay: string;
  now: number;
}

export type DryRunResponse = ({ ok: true } & DryRunData) | { ok: false; error: string };

export interface ApplyResult {
  leadsCreated: number;
  leadsUpdated: number;
  clientsCreated: number;
  clientsLinked: number;
  contactsAdded: number;
  doNotContact: number;
  runsPlaced: number;
  /** Of those, how many wait for a flow that is off. */
  runsWaiting: number;
  messagesQueued: number;
  unchanged: number;
  alreadyImported: number;
  skipped: number;
  failed: number;
  holdingCreated: boolean;
  /** At most 20, naming GoHighLevel contact ids only. */
  errors: string[];
}

export type ImportResponse = { ok: true; result: ApplyResult } | { ok: false; error: string };

/** What the lead and client pages show for an imported person. Staff only. */
export interface ImportedPersonView {
  ghlStage: string | null;
  daysInStage: number | null;
  ghlSource: string | null;
  tags: string[];
  treatment: string | null;
  usedBefore: string | null;
  town: string | null;
  staffMedicalNote: string | null;
  doNotContact: boolean;
  importedAt: number;
}
