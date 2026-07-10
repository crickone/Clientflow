/** What the editor inspector is currently focused on. */
export type Selection =
  | { kind: "segment"; index: number }
  | { kind: "broll"; index: number }
  | { kind: "caption"; segmentId: number }
  | null;
