import "server-only";

import { controlSqlite } from "@/lib/db/control";

const DEFAULTS: Record<string, string> = {
  monthly_price_cents: "9900",
  vat_rate_bp: "2300",
  billing_from_email: "billing@adonisagent.ie",
  billing_from_name: "AdonisAgent Billing",
};

export function getPlatformSetting(key: string): string | null {
  const row = controlSqlite
    .prepare("SELECT value FROM platform_settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? DEFAULTS[key] ?? null;
}

export function setPlatformSetting(key: string, value: string): void {
  controlSqlite
    .prepare(
      "INSERT INTO platform_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

export function getMonthlyPriceCents(): number {
  return Number(getPlatformSetting("monthly_price_cents"));
}
export function getVatRateBp(): number {
  return Number(getPlatformSetting("vat_rate_bp"));
}
