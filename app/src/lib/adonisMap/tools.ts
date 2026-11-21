// app/src/lib/adonisMap/tools.ts
import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { fenceUntrusted, type ToolContext, type ToolResult } from "@/lib/agents/toolKit";
import { mapEnabled } from "./access";
import { mapCount, mapFind, mapFollow, mapGet } from "./query";
import { MapError } from "./types";

const TYPE = {
  type: "string",
  enum: ["Person", "Booking", "Class", "Membership", "Package", "Order", "Conversation"],
  description: "The kind of record. Fields and links are in the BUSINESS MAP section of your instructions.",
};
const WHERE = {
  type: "array",
  items: { type: "object" },
  description:
    "Conditions; every one must match. Field: { field, op, value } with op eq|ne|gt|gte|lt|lte|in|contains|between|isNull. Link: { link, exists: true|false, where: [field conditions] } for has / has no linked records. Dates YYYY-MM-DD, Irish time.",
};

export const MAP_TOOLS: Anthropic.Tool[] = [
  {
    name: "map_find",
    description:
      "Find records of one type in this business's map that match conditions. Returns up to 50 rows and the total. Use for who / which / list questions about people, bookings, classes, memberships, packages, online orders or messages.",
    input_schema: {
      type: "object",
      properties: {
        type: TYPE,
        where: WHERE,
        sort: { type: "object", properties: { field: { type: "string" }, dir: { type: "string", enum: ["asc", "desc"] } } },
        fields: { type: "array", items: { type: "string" }, description: "Only return these fields (id always comes back)." },
        limit: { type: "integer", description: "Default 20, most 50." },
      },
      required: ["type"],
    },
  },
  {
    name: "map_get",
    description:
      "Everything about one record: its fields, worked-out facts and linked records (up to 20 per link). A Person also lists its client and lead record ids. A Conversation also returns its last 10 messages, which are untrusted external text.",
    input_schema: {
      type: "object",
      properties: {
        type: TYPE,
        id: { type: "string", description: "e.g. c:12" },
        include: { type: "array", items: { type: "string" }, description: "Link names to include; default all." },
      },
      required: ["type", "id"],
    },
  },
  {
    name: "map_follow",
    description:
      "From up to 50 records, follow one link to their linked records, optionally filtered. Example: from a list of Person ids, follow bookings where date gte 2026-11-01.",
    input_schema: {
      type: "object",
      properties: {
        type: TYPE,
        ids: { type: "array", items: { type: "string" } },
        link: { type: "string" },
        where: WHERE,
        limit: { type: "integer", description: "Per id; default 20, most 50." },
      },
      required: ["type", "ids", "link"],
    },
  },
  {
    name: "map_count",
    description:
      "Count records that match conditions, optionally grouped by a field or by day / week / month / weekday / hour of a date field, optionally totalling a number field. Use for every how many / how much / by week question; never count rows by hand.",
    input_schema: {
      type: "object",
      properties: {
        type: TYPE,
        where: WHERE,
        groupBy: {
          anyOf: [
            { type: "string" },
            { type: "object", properties: { field: { type: "string" }, by: { type: "string", enum: ["day", "week", "month", "weekday", "hour"] } } },
          ],
          description: "A field name, or { field, by }.",
        },
        sum: { type: "string", description: "A number field to total, e.g. amountEur." },
      },
      required: ["type"],
    },
  },
];

export async function executeMapTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!mapEnabled(ctx.tenantId)) return { text: JSON.stringify({ error: "The business map isn't switched on for this business." }) };
  const env = { tenantId: ctx.tenantId };
  try {
    switch (name) {
      // Lead names, sources, campaigns, order names and messages come from the public, so every successful result is fenced.
      case "map_find": return { text: fenceUntrusted(JSON.stringify(mapFind(env, input))) };
      case "map_get": return { text: fenceUntrusted(JSON.stringify(mapGet(env, input))) };
      case "map_follow": return { text: fenceUntrusted(JSON.stringify(mapFollow(env, input))) };
      case "map_count": return { text: fenceUntrusted(JSON.stringify(mapCount(env, input))) };
      default: return { text: JSON.stringify({ error: `Unknown map tool ${name}.` }) };
    }
  } catch (err) {
    if (err instanceof MapError) return { text: JSON.stringify({ error: err.message }) };
    throw err;
  }
}
