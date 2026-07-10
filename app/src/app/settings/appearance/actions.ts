"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { clearTheme, setTheme } from "@/lib/settings";
import { HEADING_FONTS } from "@/lib/theme";

export type ThemeResult = { ok: true } | { ok: false; error: string };

const FONT_IDS = new Set(HEADING_FONTS.map((f) => f.id));
const hex = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Enter a valid hex colour.");
const schema = z.object({
  bg: hex,
  accent: hex,
  headingFont: z.string().refine((v) => FONT_IDS.has(v), "Unknown heading font."),
});

export async function saveThemeAction(input: {
  bg: string;
  accent: string;
  headingFont: string;
}): Promise<ThemeResult> {
  await requireAdmin();
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid colour." };
  }
  setTheme(parsed.data);
  // Re-render the whole tree so the injected theme <style> updates everywhere.
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function resetThemeAction(): Promise<ThemeResult> {
  await requireAdmin();
  clearTheme();
  revalidatePath("/", "layout");
  return { ok: true };
}
