import { createHash, randomBytes } from "node:crypto";
import prisma from "./db.server";
import { meetsMinimum } from "./orders.server";
import { RESTRICTED_CATEGORIES } from "./categories";

// Every tier gets the same number of ad slots
export const MAX_SLOTS = 3;

// Plans: 1 = Starter, 2 = Growth, 3 = Scale, 4 = Enterprise (placeholder, custom later).
// One page view that shows partner ads counts as one view.
const DAILY_VIEW_CAP: Record<number, number> = { 1: 15, 2: 60, 3: 200, 4: 1000 };
const DAILY_CLICK_CAP: Record<number, number> = { 1: 1, 2: 3, 3: 10, 4: 50 };

// A new store's ads join the pool only after its page has shown this many
// partner-ad page views.
const EARN_FIRST_VIEWS = 5;

// Daily counters reset at 00:00 UTC.
function startOfUtcDay() {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export type ServedAd = {
  id: string;
  title: string;
  text: string;
  code: string | null;
  token: string;
};

// Picks up to MAX_SLOTS swap ads for the store with this domain.
// Returns an empty list when the store should show its own products instead.
// orderId: one order counts as one view, so reloading the same order's page
// shows the same ads and is not counted again.
export async function pickSwapAds(
  domain: string,
  orderId?: string | null,
): Promise<ServedAd[]> {
  const me = await prisma.shop.findUnique({
    where: { domain },
    include: {
      blockedStores: { select: { domain: true } },
      pinnedStores: { select: { domain: true } },
    },
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

  // One view per order: a reload of the same order's page shows the same ads
  const dedupeKey = orderId
    ? createHash("sha256").update(`${me.id}:${orderId}`).digest("hex")
    : null;
  if (dedupeKey) {
    const already = await prisma.click.findMany({
      where: { senderShopId: me.id, dedupeKey },
      include: { ad: true },
    });
    if (already.length > 0) {
      return already.map((click) => ({
        id: click.ad.id,
        title: click.ad.title,
        text: click.ad.text,
        code: click.ad.code,
        token: click.token,
      }));
    }
  }

  // Daily limits: whichever is hit first switches this store to its own products
  const plan = me.plan ?? 1;
  const viewCap = DAILY_VIEW_CAP[plan] ?? DAILY_VIEW_CAP[1];
  const clickCap = DAILY_CLICK_CAP[plan] ?? DAILY_CLICK_CAP[1];
  const since = startOfUtcDay();

  const viewsToday = (
    await prisma.click.groupBy({
      by: ["viewId"],
      where: {
        senderShopId: me.id,
        viewId: { not: null },
        createdAt: { gte: since },
      },
    })
  ).length;
  if (viewsToday >= viewCap) return [];

  const clicksToday = await prisma.click.count({
    where: {
      senderShopId: me.id,
      status: { in: ["clicked", "settled"] },
      createdAt: { gte: since },
    },
  });
  if (clicksToday >= clickCap) return [];

  const blockedDomains = me.blockedStores.map((block) => block.domain);
  const pinnedList = me.pinnedStores.map((pin) => pin.domain);

  // Partner-only mode: only the stores this store pinned may show.
  // Nothing pinned means no partner ads, so its own products fill the slots.
  if (me.pinnedOnly && pinnedList.length === 0) return [];

  // Locked stores: Thank You slots set to "locked_store" name one partner
  // that should show first. A lock only counts while that store is still pinned.
  const lockedSlots = await prisma.slot.findMany({
    where: {
      shopId: me.id,
      surface: "thank_you",
      active: true,
      mode: "locked_store",
      lockedDomain: { not: null },
    },
    select: { lockedDomain: true },
  });
  const lockedList = lockedSlots
    .map((slot) => slot.lockedDomain as string)
    .filter((d) => pinnedList.includes(d));

  // Categories this store will not see: the ones it blocked, plus adult and
  // restricted stores unless this store turned them on.
  const hiddenCategories = [
    ...me.blockedCategories,
    ...(me.showRestricted ? [] : RESTRICTED_CATEGORIES),
  ];

  // Ads come only from OTHER stores that also have swap on, and never from
  // stores or categories this store blocked, or stores that blocked this store.
  // An advertiser with no category set is never shown.
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
        // Earn-first rule: the advertiser has to have shown partner ads first
        poolEligibleAt: { not: null },
        domain: {
          not: domain,
          notIn: blockedDomains,
          ...(me.pinnedOnly ? { in: pinnedList } : {}),
        },
        blockedStores: { none: { domain } },
        niche: { not: null, notIn: hiddenCategories },
      },
    },
    include: { shop: { select: { ordersLast30: true, domain: true } } },
    take: 200,
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

  // Shuffle, then order: locked stores first, then pinned stores, then the rest
  const pinnedDomains = new Set(pinnedList);
  const lockedDomains = new Set(lockedList);
  const rank = (d: string) =>
    lockedDomains.has(d) ? 0 : pinnedDomains.has(d) ? 1 : 2;
  const shuffled = [...ads]
    .sort(() => Math.random() - 0.5)
    .sort((a, b) => rank(a.shop.domain) - rank(b.shop.domain));

  // Pick up to MAX_SLOTS ads, never two from the same store
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
      dedupeKey,
    })),
  });

  // Earn-first rule: after enough partner-ad page views, this store's own
  // ads join the pool for everyone else.
  if (!me.poolEligibleAt) {
    const totalViews = (
      await prisma.click.groupBy({
        by: ["viewId"],
        where: { senderShopId: me.id, viewId: { not: null } },
      })
    ).length;
    if (totalViews >= EARN_FIRST_VIEWS) {
      await prisma.shop.update({
        where: { id: me.id },
        data: { poolEligibleAt: new Date() },
      });
    }
  }

  return rows.map(({ ad, token }) => ({
    id: ad.id,
    title: ad.title,
    text: ad.text,
    code: ad.code,
    token,
  }));
}