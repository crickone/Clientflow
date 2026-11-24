import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { getCurrentTenant } from "@/lib/db/tenant";
import { campaigns, membershipPlans, offerOrders, offers, packagePlans, packageTemplates, therapies } from "@/lib/db/schema";
import { getBusinessProfile } from "@/lib/businessProfile";
import { formatEur, offerState, parseItems, useByLabel, formatUseByDate } from "@/lib/offers/model";
import { getStoreSettings, storeFlagOn } from "@/lib/vouchers/store";
import { catalogText, type CatalogData } from "./businessCatalogModel";

/**
 * Everything the business sells beyond single sessions -- offers on sale now,
 * packages, memberships and gift vouchers -- read live from the database, so
 * an AI reply quotes the price the business charges today. Single-session
 * prices stay in formatServices (businessContext.ts).
 *
 * Each section is read on its own and a failure leaves only that section out:
 * a reply with no package list is better than no reply.
 */
export function formatCatalog(now = Date.now()): string {
  return catalogText(readCatalog(now));
}

function safely<T>(label: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    console.error(`[businessCatalog] ${label} unreadable:`, err);
    return fallback;
  }
}

function siteBase(): string | null {
  const w = getBusinessProfile().website.trim();
  if (!w) return null;
  const withScheme = /^https?:\/\//i.test(w) ? w : `https://${w}`;
  return withScheme.replace(/\/+$/, "");
}

function readCatalog(now: number): CatalogData {
  const therapyName = new Map(
    safely("therapies", () => db.select({ id: therapies.id, name: therapies.name }).from(therapies).all(), []).map((t) => [t.id, t.name]),
  );
  const base = siteBase();

  const offerLines = safely(
    "offers",
    () => {
      const rows = db.select().from(offers).where(eq(offers.isActive, true)).all();
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      const paid = db
        .select({ offerId: offerOrders.offerId })
        .from(offerOrders)
        .where(and(inArray(offerOrders.offerId, ids), eq(offerOrders.status, "paid")))
        .all();
      const taken = new Map<number, number>();
      for (const p of paid) taken.set(p.offerId, (taken.get(p.offerId) ?? 0) + 1);
      const campaignIds = rows.map((r) => r.campaignId).filter((c): c is number => c != null);
      const slugs = new Map(
        campaignIds.length
          ? db.select({ id: campaigns.id, slug: campaigns.slug }).from(campaigns).where(inArray(campaigns.id, campaignIds)).all().map((c) => [c.id, c.slug])
          : [],
      );
      return rows.flatMap((o) => {
        const state = offerState(
          { isActive: Boolean(o.isActive), saleStartsAt: o.saleStartsAt ?? null, saleEndsAt: o.saleEndsAt ?? null, quantityLimit: o.quantityLimit ?? null },
          taken.get(o.id) ?? 0,
          now,
        );
        if (state !== "live" && state !== "scheduled") return [];
        const slug = o.campaignId != null ? slugs.get(o.campaignId) : undefined;
        return [
          {
            title: o.title,
            price: formatEur(o.priceCents),
            usual: o.compareAtCents ? formatEur(o.compareAtCents) : null,
            includes: parseItems(o.itemsJson).map((i) => `${i.sessions} x ${therapyName.get(i.therapyId) ?? "session"}`),
            description: o.description ?? "",
            useBy: useByLabel({ useWithinDays: o.useWithinDays ?? null, useByDate: o.useByDate }),
            startsOn: state === "scheduled" && o.saleStartsAt ? formatUseByDate(new Date(o.saleStartsAt).toISOString().slice(0, 10)) : null,
            endsOn: o.saleEndsAt ? formatUseByDate(new Date(o.saleEndsAt).toISOString().slice(0, 10)) : null,
            left: o.quantityLimit != null ? Math.max(0, o.quantityLimit - (taken.get(o.id) ?? 0)) : null,
            url: base && slug ? `${base}/c/${slug}` : null,
          },
        ];
      });
    },
    [],
  );

  const bundles = safely(
    "session bundles",
    () =>
      db
        .select()
        .from(packageTemplates)
        .where(eq(packageTemplates.isActive, true))
        .all()
        .map((p) => ({
          name: p.name,
          sessions: p.totalSessions,
          therapy: p.therapyId != null ? (therapyName.get(p.therapyId) ?? null) : null,
          price: p.priceEur != null ? `€${Number(p.priceEur).toLocaleString("en-IE", { maximumFractionDigits: 2 })}` : null,
          validityMonths: p.validityMonths ?? null,
          recurring:
            p.planType === "recurring_membership" && p.recurringPriceEur != null
              ? `€${Number(p.recurringPriceEur).toLocaleString("en-IE", { maximumFractionDigits: 2 })} every ${p.billingIntervalMonths ?? 1} month${(p.billingIntervalMonths ?? 1) === 1 ? "" : "s"}`
              : null,
          notes: p.notes ?? "",
        })),
    [],
  );

  const packages = safely(
    "packages",
    () =>
      db
        .select()
        .from(packagePlans)
        .where(and(eq(packagePlans.isActive, true), eq(packagePlans.forSale, true)))
        .all()
        .map((p) => ({
          name: p.name,
          price: formatEur(p.priceCents),
          sessions: p.unlimitedSessions ? "unlimited sessions" : `${p.sessionsQuantity ?? 0} sessions`,
          validFor: p.unlimitedDuration ? null : p.expirationCount ? `${p.expirationCount} ${p.expirationInterval ?? "months"}` : null,
          description: p.description ?? "",
        })),
    [],
  );

  const memberships = safely(
    "memberships",
    () =>
      db
        .select()
        .from(membershipPlans)
        .where(and(eq(membershipPlans.isActive, true), eq(membershipPlans.forSale, true)))
        .all()
        .map((m) => ({
          name: m.name,
          price: formatEur(m.priceCents),
          every: `${m.billingCount && m.billingCount > 1 ? `${m.billingCount} ` : ""}${m.billingInterval ?? "month"}${m.billingCount && m.billingCount > 1 ? "s" : ""}`,
          joiningFee: m.joiningFeeCents ? formatEur(m.joiningFeeCents) : null,
          sessions: m.unlimitedSessions ? "unlimited sessions" : m.sessionsQuantity ? `${m.sessionsQuantity} sessions` : null,
          description: m.description ?? "",
        })),
    [],
  );

  const vouchers = safely(
    "gift vouchers",
    () => {
      if (!storeFlagOn(getCurrentTenant().id)) return null;
      const s = getStoreSettings();
      if (!s.enabled) return null;
      return {
        amounts: s.amounts.map((a) => `€${a}`),
        custom: s.allowCustom ? `any amount from €${s.customMin} to €${s.customMax}` : null,
        treatments: s.therapyIds.map((id) => therapyName.get(id)).filter((n): n is string => Boolean(n)),
        validYears: s.expiryYears,
        url: base ? `${base}/vouchers` : null,
      };
    },
    null,
  );

  return { offers: offerLines, bundles, packages, memberships, vouchers };
}
