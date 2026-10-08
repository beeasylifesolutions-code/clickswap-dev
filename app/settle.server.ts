import prisma from "./db.server";

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
  let skipped = 0;

  for (const click of due) {
    const result = await prisma.$transaction(async (tx) => {
      // Claim the click so it can only ever be paid once
      const claimed = await tx.click.updateMany({
        where: { id: click.id, status: "clicked" },
        data: { status: "settled", settledAt: new Date() },
      });
      if (claimed.count === 0) return "skipped";

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
    else skipped += 1;
  }

  return { checked: due.length, settled, unfunded, skipped };
}