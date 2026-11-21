// app/src/lib/adonisMap/names.ts
/** The map's tool names. Pure, so prompt and category code can import it cheaply. */
export const MAP_TOOL_NAMES = ["map_find", "map_get", "map_follow", "map_count"] as const;
export const MAP_TOOL_SET: ReadonlySet<string> = new Set<string>(MAP_TOOL_NAMES);
