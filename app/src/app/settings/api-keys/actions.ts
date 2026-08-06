"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentMembership, requireAdmin } from "@/lib/auth";
import { generateApiKey, revokeApiKey } from "@/lib/apiKeys";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type CreateKeyResult =
  | { ok: true; raw: string; prefix: string }
  | { ok: false; error: string };

/**
 * The acting admin's active tenant. requireAdmin already throws unless the caller
 * is an admin in the active tenant, so getCurrentMembership is non-null here.
 * Every action below is scoped to THIS tenant — a key is minted for / revoked in
 * the clinic the admin is currently in, never a client-supplied tenantId.
 */
async function adminTenantId(): Promise<number> {
  await requireAdmin();
  const current = getCurrentMembership();
  if (!current) throw new Error("UNAUTHENTICATED");
  return current.tenant.id;
}

// Only 'leads' exists today; the select is forward-compatible for more scopes.
const ALLOWED_SCOPES = ["leads"] as const;

const createSchema = z.object({
  label: z.string().max(80).optional(),
  scope: z.enum(ALLOWED_SCOPES).default("leads"),
});

/**
 * Mint a new key for the active tenant. The raw secret is returned ONCE for the
 * UI to display — it is never stored in plaintext and can't be shown again.
 */
export async function createApiKeyAction(input: {
  label?: string;
  scope?: string;
}): Promise<CreateKeyResult> {
  const tenantId = await adminTenantId();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }
  const { raw, prefix } = generateApiKey(
    tenantId,
    parsed.data.label?.trim() || null,
    parsed.data.scope,
  );
  revalidatePath("/settings/api-keys");
  return { ok: true, raw, prefix };
}

/** Revoke a key. Scoped to the active tenant — you can't revoke another's key. */
export async function revokeApiKeyAction(id: number): Promise<ActionResult> {
  const tenantId = await adminTenantId();
  if (!Number.isInteger(id)) return { ok: false, error: "Invalid key" };
  revokeApiKey(tenantId, id);
  revalidatePath("/settings/api-keys");
  return { ok: true };
}
