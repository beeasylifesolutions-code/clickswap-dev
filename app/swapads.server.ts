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
  // Only stores with swap on, consent given and enough paid orders
  // can show other stores' ads
  const me = await prisma.shop.findUnique({ where: { domain } });
  if (
    !me ||
    !me.swapEnabled ||
    !me.consentAt ||
    !meetsMinimum(me.ordersLast30)
  ) {
    return [];
  }

  // Ads come only from OTHER stores that also have swap on
  const candidates = await prisma.ad.findMany({
    where: {
      active: true,
      shop: {
        swapEnabled: true,
        consentAt: { not: null },
        domain: { not: domain },
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

  // One single-use token per ad shown
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