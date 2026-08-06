import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requirePlatformAdmin } from "@/lib/auth";
import { createTenant, listTenants } from "@/lib/tenants";

export const dynamic = "force-dynamic";

const schema = z.object({
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, digits, hyphens"),
  name: z.string().min(1).max(120),
  venueType: z.enum(["clinic", "gym"]).optional(),
  admin: z
    .object({
      email: z.string().email(),
      // Optional: omitted when attaching an existing identity (who already has a
      // password) as an admin of the new tenant. Required for a brand-new email,
      // enforced in createTenantAdmin.
      password: z.string().min(8).optional(),
      name: z.string().min(1).max(120).optional(),
    })
    .optional(),
});

/** Platform-admin: list tenants. */
export async function GET() {
  try {
    await requirePlatformAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ tenants: listTenants() });
}

/** Platform-admin: provision a new tenant (+ optional first admin user). */
export async function POST(req: NextRequest) {
  try {
    await requirePlatformAdmin();
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  try {
    const tenant = createTenant(parsed.data);
    return NextResponse.json({ ok: true, tenant });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create tenant" },
      { status: 400 },
    );
  }
}
