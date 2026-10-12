import { randomBytes } from "node:crypto";
import prisma from "./db.server";
import { meetsMinimum } from "./orders.server";

// Every tier gets the same number of ad slots
export const MAX_SLOTS = 3;

export type ServedAd = {
  id: string;
  title: string;
  text: string;
  code: string | null;
  token: string;
};

// Picks up to MAX_SLOTS swap ads for the store with this domain.
// Used by both the Thank You page and the order status page.
export async function pickSwapAds(domain: string): Promise<ServedAd[]> {
  const me = await prisma.shop.findUnique({
    where: { domain },
    include: { blockedStores: { select: { domain: true } } },
  });

  // Only stores with swap on, consent given, enough paid orders,
  // and no kill switch or suspension can show other stores' ads
  if (
    !me ||
    !me.swapEnabled ||
    !me.consentAt ||
    me.killSwitch ||
    me.suspended ||
    !meetsMinimum(me.ordersLast30)
  ) {
    return [];
  }

  const blockedDomains = me.blockedStores.map((block) => block.domain);
  const blockedCategories = me.blockedCategories;

  // Ads come only from OTHER stores that also have swap on, and never from
  // stores or categories this store blocked, or stores that blocked this store
  const candidates = await prisma.ad.findMany({
    where: {
      active: true,
      disabled: false,
      // Skip ads this store has reported
      reports: { none: { shopId: me.id } },
      shop: {
        swapEnabled: true,
        consentAt: { not: null },
        killSwitch: false,
        suspended: false,
        domain: { not: domain, notIn: blockedDomains },
        blockedStores: { none: { domain } },
        ...(blockedCategories.length > 0
          ? {
              OR: [
                { niche: null },
                { niche: { notIn: blockedCategories } },
              ],
            }
          : {}),
      },
    },
    include: { shop: { select: { ordersLast30: true } } },
    take: 50,
  });

  // Advertisers must also meet the order minimum
  const eligible = candidates.filter((ad) =>
    meetsMinimum(ad.shop.ordersLast30),
  );

  // Skip advertisers that have run out of credits
  const shopIds = [...new Set(eligible.map((ad) => ad.shopId))];
  const balances = await prisma.creditLedger.groupBy({
    by: ["shopId"],
    where: { shopId: { in: shopIds } },
    _sum: { delta: true },
  });
  const funded = new Set(
    balances.filter((row) => (row._sum.delta ?? 0) >= 1).map((row) => row.shopId),
  );
  const ads = eligible.filter((ad) => funded.has(ad.shopId));

  if (ads.length === 0) return [];

  // Pick up to MAX_SLOTS ads, never two from the same store
  const shuffled = [...ads].sort(() => Math.random() - 0.5);
  const seenShops = new Set<string>();
  const chosen: typeof ads = [];
  for (const ad of shuffled) {
    if (seenShops.has(ad.shopId)) continue;
    seenShops.add(ad.shopId);
    chosen.push(ad);
    if (chosen.length === MAX_SLOTS) break;
  }

  // One single-use token per ad shown. The ads shown together on one
  // page view share a viewId, so a page view can be counted once.
  const viewId = randomBytes(8).toString("hex");
  const rows = chosen.map((ad) => ({
    ad,
    token: randomBytes(24).toString("hex"),
  }));
  await prisma.click.createMany({
    data: rows.map(({ ad, token }) => ({
      token,
      adId: ad.id,
      senderShopId: me.id,
      advertiserShopId: ad.shopId,
      viewId,
    })),
  });

  return rows.map(({ ad, token }) => ({
    id: ad.id,
    title: ad.title,
    text: ad.text,
    code: ad.code,
    token,
  }));
}