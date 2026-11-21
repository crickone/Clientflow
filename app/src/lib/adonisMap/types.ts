// app/src/lib/adonisMap/types.ts
/** Shared types for the Adonis business map. Pure: no imports. */

export type TypeName = "Person" | "Booking" | "Class" | "Membership" | "Package" | "Order" | "Conversation";
export const TYPE_NAMES: readonly TypeName[] = ["Person", "Booking", "Class", "Membership", "Package", "Order", "Conversation"];

export type FieldType = "text" | "number" | "date" | "datetime" | "bool" | "enum";

export interface FieldDef {
  name: string;
  type: FieldType;
  about: string;
  values?: readonly string[];
  /** Worked out from other records rather than stored. */
  computed?: boolean;
}

/** A source row S links to target rows T where T[to] === S[from]. */
export interface LinkDef {
  name: string;
  target: TypeName;
  about: string;
  from: string;
  to: string;
}

export interface TypeDef {
  name: TypeName;
  about: string;
  idHint: string;
  fields: FieldDef[];
  links: LinkDef[];
  /** The date field a date range can be pushed down into the SQL load on, or null. */
  dateField: string | null;
  /** Most rows one load may bring into memory. */
  maxRows: number;
}

export type Row = { id: string; [field: string]: unknown };

export type Op = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "contains" | "between" | "isNull";
export interface FieldCondition { field: string; op: Op; value?: unknown }
export interface LinkCondition { link: string; exists: boolean; where?: FieldCondition[] }
export type Condition = FieldCondition | LinkCondition;

export type DateBucket = "day" | "week" | "month" | "weekday" | "hour";
export type GroupBy = string | { field: string; by: DateBucket };

export interface DateRange { from?: string; to?: string }

/** A query that doesn't fit the map. The message goes back to the model so it can correct itself. */
export class MapError extends Error {}

export function isLinkCondition(c: Condition): c is LinkCondition {
  return typeof (c as LinkCondition).link === "string";
}
