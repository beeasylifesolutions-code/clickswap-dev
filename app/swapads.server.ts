import { createHash, randomBytes } from "node:crypto";
import prisma from "./db.server";
import { meetsMinimum } from "./orders.server";
import { RESTRICTED_CATEGORIES } from "./categories";

// Every tier gets the same number of ad slots
export const MAX_SLOTS = 3;

// Plans: 1 = Starter, 2 = Growth, 3 = Scale, 4 = Enterprise (placeholder, custom later).
// Daily limit on clicks SENT from the store's own page (each one earns a credit).
// There is no limit on partner-ad page views: showing an ad costs nobody anything,
// only clicks move credits.
const DAILY_CLICK_CAP: Record<number, number> = { 1: 3, 2: 10, 3: 30, 4: 50 };

// A new store's ads join the pool only after its page has shown this many
// partner-ad page views.
const EARN_FIRST_VIEWS = 5;

// Fair-share rotation looks at how each ad did over this many days
const FAIR_SHARE_DAYS = 7;
const MIN_PERFORMANCE = 0.3;
const MAX_PERFORMANCE = 3;

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

// Fair-share weight for each ad: ads shown less often than average get a
// bigger weight, and ads that earn clicks get a bigger weight too. Weak ads
// fade but never disappear, and brand-new ads start with a good share.
async function adWeights(adIds: string[]) {
  const since = new Date(Date.now() - FAIR_SHARE_DAYS * 24 * 60 * 60 * 1000);
  const [shown, clicked] = await Promise.all([
    prisma.click.groupBy({
      by: ["adId"],
      where: { adId: { in: adIds }, createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.click.groupBy({
      by: ["adId"],
      where: {
        adId: { in: adIds },
        createdAt: { gte: since },
        usedAt: { not: null },
      },
      _count: { _all: true },
    }),
  ]);
  const shownBy = new Map(shown.map((row) => [row.adId, row._count._all]));
  const clickedBy = new Map(clicked.map((row) => [row.adId, row._count._all]));
  let total = 0;
  for (const id of adIds) total += shownBy.get(id) ?? 0;
  const average = adIds.length > 0 ? total / adIds.length : 0;

  const weights = new Map<string, number>();
  for (const id of adIds) {
    const timesShown = shownBy.get(id) ?? 0;
    const timesClicked = clickedBy.get(id) ?? 0;
    // 1 for an ad never shown, falling as it is shown more than the average
    const freshness = 1 / (1 + timesShown / (average + 5));
    // Click rate with a starting guess of about 4%, so a few views do not swing it
    const raw = (25 * (timesClicked + 1)) / (timesShown + 25);
    const performance = Math.min(MAX_PERFORMANCE, Math.max(MIN_PERFORMANCE, raw));
    weights.set(id, freshness * performance);
  }
  return weights;
}

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

  // Daily limit: once this store has sent its clicks for the day, its page
  // shows its own products until the counters reset
  const plan = me.plan ?? 1;
  const clickCap = DAILY_CLICK_CAP[plan] ?? DAILY_CLICK_CAP[1];
  const since = startOfUtcDay();

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

  // Circles: stores that share a Circle with this store
  const myCircles = await prisma.circleMember.findMany({
    where: { shopId: me.id },
    select: { circleId: true },
  });
  const circleMates =
    myCircles.length > 0
      ? await prisma.circleMember.findMany({
          where: {
            circleId: { in: myCircles.map((row) => row.circleId) },
            shopId: { not: me.id },
          },
          select: { shopId: true },
        })
      : [];
  const mateIds = [...new Set(circleMates.map((row) => row.shopId))];

  // Circle-only mode: only Circle partners may show.
  // No Circle partners means no partner ads, so its own products fill the slots.
  if (me.circleOnly && mateIds.length === 0) return [];

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

  // Categories this store will not see: the ones it blocked, adult and
  // restricted stores unless this store turned them on, and stores in its own
  // category (its competitors) unless this store allowed them.
  const hiddenCategories = [
    ...me.blockedCategories,
    ...(me.showRestricted ? [] : RESTRICTED_CATEGORIES),
    ...(me.showSameCategory || !me.niche ? [] : [me.niche]),
  ];

  // Development (test) stores are kept out of the real pool. The temporary
  // setting DEV_STORE_TESTING=true lets them swap with each other for testing.
  // eslint-disable-next-line no-undef
  const devTesting = process.env.DEV_STORE_TESTING === "true";

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
        ...(devTesting ? {} : { isDevStore: false }),
        ...(me.circleOnly ? { id: { in: mateIds } } : {}),
        domain: {
          not: domain,
          notIn: blockedDomains,
          ...(me.pinnedOnly ? { in: pinnedList } : {}),
        },
        blockedStores: { none: { domain } },
        niche: { not: null, notIn: hiddenCategories },
      },
    },
    include: {
      shop: { select: { ordersLast30: true, domain: true, id: true } },
    },
    take: 500,
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

  // Order: locked stores first, then pinned stores, then Circle partners,
  // then everyone else. Inside each group, a fair-share weighted draw decides
  // who goes first: ads shown less often and ads that earn clicks come first.
  const pinnedDomains = new Set(pinnedList);
  const lockedDomains = new Set(lockedList);
  const mateSet = new Set(mateIds);
  const rank = (ad: { shop: { domain: string; id: string } }) =>
    lockedDomains.has(ad.shop.domain)
      ? 0
      : pinnedDomains.has(ad.shop.domain)
        ? 1
        : mateSet.has(ad.shop.id)
          ? 2
          : 3;
  const weights = await adWeights(ads.map((ad) => ad.id));
  const drawn = ads
    .map((ad) => ({
      ad,
      key: Math.random() ** (1 / (weights.get(ad.id) ?? 1)),
    }))
    .sort((a, b) => b.key - a.key)
    .map((entry) => entry.ad);
  const shuffled = drawn.sort((a, b) => rank(a) - rank(b));

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