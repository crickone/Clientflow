"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/db/tenant";
import { logActivity } from "@/lib/queries";
import { parseAmountList, validateStoreSettings } from "@/lib/vouchers/model";
import { listSellableTherapies, saveStoreSettings, storeFlagOn } from "@/lib/vouchers/store";

export interface StoreSettingsInput {
  enabled: boolean;
  amountsText: string;
  allowCustom: boolean;
  customMin: number;
  customMax: number;
  therapyIds: number[];
  intro: string;
  expiryYears: number;
  bookUrl: string;
}

/** Products > Vouchers > Online store. Admin only, and only with the voucher_store module on. */
export async function saveVoucherStoreAction(input: StoreSettingsInput): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  if (!storeFlagOn(getCurrentTenant().id)) return { ok: false, error: "The online voucher store isn't switched on for this business." };
  if (!input || typeof input !== "object" || typeof input.amountsText !== "string" || !Array.isArray(input.therapyIds)) {
    return { ok: false, error: "Those settings could not be read. Reload the page and try again." };
  }
  const amounts = parseAmountList(input.amountsText);
  if (amounts === null) return { ok: false, error: "Write the amounts as whole euros with commas, like 25, 50, 100." };
  // Only this business's own active, priced services can be ticked.
  const sellable = new Set(listSellableTherapies().map((t) => t.id));
  const checked = validateStoreSettings({
    enabled: input.enabled === true,
    amounts,
    allowCustom: input.allowCustom === true,
    customMin: Number(input.customMin),
    customMax: Number(input.customMax),
    therapyIds: input.therapyIds.map(Number).filter((id) => sellable.has(id)),
    intro: String(input.intro ?? ""),
    expiryYears: Number(input.expiryYears),
    bookUrl: String(input.bookUrl ?? ""),
  });
  if (!checked.ok) return checked;
  saveStoreSettings(checked.value);
  await logActivity("voucher_store.settings", `Online voucher store ${checked.value.enabled ? "on" : "off"}; settings saved.`, {});
  revalidatePath("/vouchers/store");
  return { ok: true };
}
