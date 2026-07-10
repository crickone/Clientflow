"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { setBrandFontIds } from "@/lib/settings";
import { FONT_OPTIONS } from "@/lib/image/fonts";

const VALID_IDS = new Set(FONT_OPTIONS.map((f) => f.id));

const schema = z.object({
  heading: z.string().refine((v) => VALID_IDS.has(v), "Unknown heading font"),
  body: z.string().refine((v) => VALID_IDS.has(v), "Unknown body font"),
});

export async function saveBrandFontsAction(input: {
  heading: string;
  body: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  setBrandFontIds(parsed.data);
  revalidatePath("/settings/branding");
  revalidatePath("/content-studio", "layout");
  return { ok: true };
}
