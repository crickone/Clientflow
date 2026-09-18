import "server-only";

import { asc, eq } from "drizzle-orm";

import { getTenantDbById } from "@/lib/db/tenant";
import * as schema from "@/lib/db/schema";
import { DEFAULT_SKILLS } from "./defaultSkills";
import {
  MAX_SKILL_BODY,
  MAX_SKILL_DESCRIPTION,
  MAX_SKILL_NAME,
  parseEnabledSkills,
  parseLoadMode,
  serialiseEnabledSkills,
  type SkillLoadMode,
  type SkillToggle,
} from "./skills.parse";

export type { SkillToggle, SkillLoadMode };
export {
  MAX_SKILL_BODY,
  MAX_SKILL_DESCRIPTION,
  MAX_SKILL_NAME,
  parseEnabledSkills,
  serialiseEnabledSkills,
};

export interface Skill {
  id: number;
  name: string;
  description: string;
  body: string;
  loadMode: SkillLoadMode;
  updatedAt: Date;
}

/**
 * Give a tenant the built-in skills it does not have yet.
 *
 * BY NAME, and only for names that are absent. An operator who edited "Say the
 * thing" keeps their version; one who deleted it deliberately gets it back on
 * the next read, which is the cost of a seeder this simple and is preferable
 * to a table of tombstones. Runs on every list, like the agent catalogue's own
 * seeding, so an existing tenant picks them up without a migration.
 *
 * Seeded but NOT switched on: a skill that turned itself on for every agent
 * the moment it appeared would rewrite prompts nobody asked it to.
 */
function seedDefaults(tenantId: number): void {
  const db = getTenantDbById(tenantId);
  const have = new Set(
    db.select({ name: schema.skills.name }).from(schema.skills).all().map((r) => r.name),
  );
  const missing = DEFAULT_SKILLS.filter((d) => !have.has(d.name));
  if (missing.length === 0) return;
  const now = new Date();
  db.insert(schema.skills)
    .values(
      missing.map((d) => ({
        name: d.name,
        description: d.description,
        body: d.body,
        loadMode: d.loadMode,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .run();
}

/** Every skill the tenant has, name-ordered for a stable list. */
export function listSkills(tenantId: number): Skill[] {
  const db = getTenantDbById(tenantId);
  seedDefaults(tenantId);
  return db
    .select()
    .from(schema.skills)
    .orderBy(asc(schema.skills.name))
    .all()
    .map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      body: r.body,
      loadMode: parseLoadMode(r.loadMode),
      updatedAt: r.updatedAt,
    }));
}

export function createSkill(
  tenantId: number,
  input: { name: string; description: string; body: string; loadMode?: SkillLoadMode },
): number {
  const db = getTenantDbById(tenantId);
  const now = new Date();
  const row = db
    .insert(schema.skills)
    .values({
      name: input.name.trim().slice(0, MAX_SKILL_NAME),
      description: input.description.trim().slice(0, MAX_SKILL_DESCRIPTION),
      body: input.body.slice(0, MAX_SKILL_BODY),
      loadMode: input.loadMode ?? "always",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: schema.skills.id })
    .get();
  return row.id;
}

export function updateSkill(
  tenantId: number,
  id: number,
  input: { name: string; description: string; body: string; loadMode?: SkillLoadMode },
): void {
  const db = getTenantDbById(tenantId);
  db.update(schema.skills)
    .set({
      name: input.name.trim().slice(0, MAX_SKILL_NAME),
      description: input.description.trim().slice(0, MAX_SKILL_DESCRIPTION),
      body: input.body.slice(0, MAX_SKILL_BODY),
      ...(input.loadMode ? { loadMode: input.loadMode } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.skills.id, id))
    .run();
}

/**
 * Delete a skill, and take it off every agent that had it on.
 *
 * The allowlist is ids in a JSON column with no foreign key behind it, so
 * without this second step a deleted skill leaves a dead id on each agent --
 * harmless while it is only skipped at compose time, and a live one again the
 * day an autoincrement reuses the number.
 */
export function deleteSkill(tenantId: number, id: number): void {
  const db = getTenantDbById(tenantId);
  db.delete(schema.skills).where(eq(schema.skills.id, id)).run();
  for (const agent of db.select().from(schema.agents).all()) {
    const ids = parseEnabledSkills(agent.enabledSkills);
    if (!ids.includes(id)) continue;
    db.update(schema.agents)
      .set({ enabledSkills: serialiseEnabledSkills(ids.filter((n) => n !== id)) })
      .where(eq(schema.agents.key, agent.key))
      .run();
  }
}

/** The tenant's skills, each marked on or off for this agent. */
export function skillTogglesFor(tenantId: number, agentKey: string): SkillToggle[] {
  const db = getTenantDbById(tenantId);
  const agent = db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.key, agentKey))
    .get();
  const on = new Set(parseEnabledSkills(agent?.enabledSkills));
  return listSkills(tenantId).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    enabled: on.has(s.id),
    size: s.body.length,
    loadMode: s.loadMode,
  }));
}

export function setAgentSkills(tenantId: number, agentKey: string, ids: number[]): void {
  const db = getTenantDbById(tenantId);
  // Only ids that exist. A stale one from a form posted before a delete would
  // otherwise be written straight back onto the agent.
  const real = new Set(listSkills(tenantId).map((s) => s.id));
  db.update(schema.agents)
    .set({ enabledSkills: serialiseEnabledSkills(ids.filter((n) => real.has(n))) })
    .where(eq(schema.agents.key, agentKey))
    .run();
}

/**
 * The bodies of the skills this agent is given, in the order the operator sees
 * them, ready to drop into a system prompt.
 *
 * Empty skills are skipped: a named skill with nothing in it is a heading the
 * model would have to interpret, which is worse than its absence.
 */
export function skillBodiesFor(tenantId: number, agentKey: string): { name: string; body: string }[] {
  return enabledSkillsFor(tenantId, agentKey)
    .filter((s) => s.loadMode === "always")
    .map((s) => ({ name: s.name, body: s.body.trim() }));
}

/** Every skill switched on for this agent, whatever its load mode. */
export function enabledSkillsFor(tenantId: number, agentKey: string): Skill[] {
  const db = getTenantDbById(tenantId);
  const agent = db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.key, agentKey))
    .get();
  const on = new Set(parseEnabledSkills(agent?.enabledSkills));
  if (on.size === 0) return [];
  return listSkills(tenantId).filter((s) => on.has(s.id) && s.body.trim());
}

/**
 * The on-demand skills, as the menu that goes in the system prompt.
 *
 * Names and descriptions only -- a few dozen tokens each against the
 * thousands a body costs. The agent reads this list and calls load_skill when
 * a job actually needs one.
 */
export function skillMenuFor(tenantId: number, agentKey: string): { name: string; description: string }[] {
  return enabledSkillsFor(tenantId, agentKey)
    .filter((s) => s.loadMode === "onDemand")
    .map((s) => ({ name: s.name, description: s.description }));
}

/** One skill's body by name, for the load_skill tool. Case-insensitive
 *  because the model is quoting a name it read, not an identifier. */
export function skillBodyByName(tenantId: number, agentKey: string, name: string): Skill | null {
  const wanted = name.trim().toLowerCase();
  return (
    enabledSkillsFor(tenantId, agentKey).find((s) => s.name.toLowerCase() === wanted) ?? null
  );
}
