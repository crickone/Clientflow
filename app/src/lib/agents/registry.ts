import "server-only";
import { getTenantDbById } from "@/lib/db/tenant";
import { agents, type Agent } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { MODELS } from "@/lib/ai/client";

export interface AgentDef { key: string; name: string; mandate: string; status: "active" | "dormant"; defaultModel: string; }
export const AGENT_CATALOG: AgentDef[] = [
  { key: "orchestrator", name: "Orchestrator", mandate: "Routes work to the right specialist.", status: "dormant", defaultModel: MODELS.sonnet },
  { key: "sales", name: "Sales", mandate: "Works leads: instant replies + relentless follow-up.", status: "active", defaultModel: MODELS.sonnet },
  { key: "seo", name: "SEO", mandate: "Publishes + optimises content for organic growth.", status: "dormant", defaultModel: MODELS.sonnet },
  { key: "marketing", name: "Marketing", mandate: "Runs the Marketing Brain: campaigns + social.", status: "dormant", defaultModel: MODELS.sonnet },
  { key: "operations", name: "Operations", mandate: "No-shows, class fill, attendance, admin.", status: "dormant", defaultModel: MODELS.sonnet },
  { key: "finance", name: "Finance", mandate: "Guards the cash: overdue + failed payments.", status: "dormant", defaultModel: MODELS.sonnet },
];

export function ensureAgents(tenantId: number): void {
  const db = getTenantDbById(tenantId);
  const existing = new Set(db.select({ key: agents.key }).from(agents).all().map(r => r.key));
  for (const a of AGENT_CATALOG) {
    if (!existing.has(a.key)) {
      db.insert(agents).values({ key: a.key, name: a.name, status: a.status, model: a.defaultModel, instructions: "" }).run();
    }
  }
}
export function listAgents(tenantId: number): Agent[] {
  ensureAgents(tenantId);
  const order = AGENT_CATALOG.map(a => a.key);
  return getTenantDbById(tenantId).select().from(agents).all()
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}
export function getAgent(tenantId: number, key: string): Agent | undefined {
  ensureAgents(tenantId);
  return getTenantDbById(tenantId).select().from(agents).where(eq(agents.key, key)).get();
}
export function updateAgentInstructions(tenantId: number, key: string, instructions: string): void {
  getTenantDbById(tenantId).update(agents).set({ instructions: instructions.slice(0, 8000), updatedAt: new Date() }).where(eq(agents.key, key)).run();
}
export function updateAgentModel(tenantId: number, key: string, model: string): void {
  const allowed = new Set<string>([MODELS.sonnet, MODELS.opus, MODELS.haiku]); // NEVER Fable
  if (!allowed.has(model)) throw new Error("Unsupported model");
  getTenantDbById(tenantId).update(agents).set({ model, updatedAt: new Date() }).where(eq(agents.key, key)).run();
}
