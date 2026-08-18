"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { setBrandFontIds, setKey, deleteKey } from "@/lib/settings";
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

/**
 * Per-tenant "house style" half of every AI post-image prompt (see
 * lib/ai/image/prompt.ts buildImagePrompt / lib/settings.ts getBrandImageStyle).
 * Empty/whitespace-only clears the override so callers fall back to
 * defaultImageStyle(getBusinessProfile()).
 */
export async function saveBrandImageStyleAction(input: {
  style: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const style = String(input?.style ?? "").trim();
  if (style.length > 600) {
    return { ok: false, error: "Keep the style under 600 characters." };
  }
  if (style) setKey("brand_image_style", style);
  else deleteKey("brand_image_style");
  return { ok: true };
}
