import prisma from "./db.server";

// Limits that stop any one store from earning too many credits.
// To change a limit, change the number here. Nothing else needs to change.
// Plans: 1 = Starter, 2 = Growth, 3 = Scale, 4 = Enterprise (placeholder, custom later).
const DAILY_CLICK_CAP: Record<number, number> = { 1: 3, 2: 10, 3: 30, 4: 50 };
const BALANCE_CEILING = 2000; // no store can hold more than this many credits
const PAIR_DAILY_CAP = 10; // paid clicks per day from one store to the same advertiser

function dailyCapFor(plan: number | null | undefined) {
  return DAILY_CLICK_CAP[plan ?? 1] ?? DAILY_CLICK_CAP[1];
}

// Daily counters reset at 00:00 UTC.
function startOfUtcDay() {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

// Pays out clicks whose 24-hour waiting period is over.
export async function settleClicks(limit = 200) {
  const now = new Date();
  const due = await prisma.click.findMany({
    where: { status: "clicked", settleAfter: { lte: now } },
    orderBy: { settleAfter: "asc" },
    take: limit,
  });

  let settled = 0;
  let unfunded = 0;
  let capped = 0;
  let skipped = 0;

  for (const click of due) {
    const result = await prisma.$transaction(async (tx) => {
      // Claim the click so it can only ever be paid once
      const claimed = await tx.click.updateMany({
        where: { id: click.id, status: "clicked" },
        data: { status: "settled", settledAt: new Date() },
      });
      if (claimed.count === 0) return "skipped";

      // A capped click pays nothing and costs the advertiser nothing
      const markCapped = async () => {
        await tx.click.update({
          where: { id: click.id },
          data: { status: "capped" },
        });
        return "capped" as const;
      };

      const sender = await tx.shop.findUnique({
        where: { id: click.senderShopId },
        select: { plan: true },
      });
      const dailyCap = dailyCapFor(sender?.plan);
      const since = startOfUtcDay();

      // Rule 1: a store can only send so many paid clicks per day
      const earnedToday = await tx.creditLedger.count({
        where: {
          shopId: click.senderShopId,
          reason: "click_sent",
          createdAt: { gte: since },
        },
      });
      if (earnedToday >= dailyCap) return markCapped();

      // Rule 2: only so many paid clicks per day between the same two stores.
      // This click is already marked settled, so it counts itself.
      const pairToday = await tx.click.count({
        where: {
          senderShopId: click.senderShopId,
          advertiserShopId: click.advertiserShopId,
          status: "settled",
          settledAt: { gte: since },
        },
      });
      if (pairToday > PAIR_DAILY_CAP) return markCapped();

      // Rule 3: a store cannot pile up more than the balance ceiling
      const senderBalance = await tx.creditLedger.aggregate({
        where: { shopId: click.senderShopId },
        _sum: { delta: true },
      });
      if ((senderBalance._sum.delta ?? 0) >= BALANCE_CEILING) {
        return markCapped();
      }

      // The advertiser must have at least 1 credit to spend
      const balance = await tx.creditLedger.aggregate({
        where: { shopId: click.advertiserShopId },
        _sum: { delta: true },
      });
      if ((balance._sum.delta ?? 0) < 1) {
        await tx.click.update({
          where: { id: click.id },
          data: { status: "unfunded" },
        });
        return "unfunded";
      }

      await tx.creditLedger.createMany({
        data: [
          {
            shopId: click.senderShopId,
            delta: 1,
            reason: "click_sent",
            clickId: click.id,
          },
          {
            shopId: click.advertiserShopId,
            delta: -1,
            reason: "click_received",
            clickId: click.id,
          },
        ],
      });
      return "settled";
    });

    if (result === "settled") settled += 1;
    else if (result === "unfunded") unfunded += 1;
    else if (result === "capped") capped += 1;
    else skipped += 1;
  }

  return { checked: due.length, settled, unfunded, capped, skipped };
}