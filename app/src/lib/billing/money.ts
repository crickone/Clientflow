/** Money is ALWAYS integer cents (EUR). VAT rates are basis points (2300 = 23%). */

export interface VatBreakdown {
  netCents: number;
  vatCents: number;
  grossCents: number;
}

/** VAT on a net amount, rounded half-up to the cent. */
export function computeVat(netCents: number, vatRateBp: number): VatBreakdown {
  const vatCents = Math.round((netCents * vatRateBp) / 10000);
  return { netCents, vatCents, grossCents: netCents + vatCents };
}

/** 12177 → "€121.77" */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}€${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
