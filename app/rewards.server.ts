import { createHash, randomInt } from "crypto";
import prisma from "./db.server";

// Weighted random pick: a prize with a bigger number wins more often
function pickPrize<T extends { weight: number }>(prizes: T[]): T {
  const total = prizes.reduce((sum, prize) => sum + prize.weight, 0);
  let roll = randomInt(total);
  for (const prize of prizes) {
    if (roll < prize.weight) return prize;
    roll -= prize.weight;
  }
  return prizes[prizes.length - 1];
}

// The checkout token may hold the store as "shop.myshopify.com" or "https://shop.myshopify.com"
export function domainOf(dest: string): string {
  const value = String(dest || "");
  if (value.includes("://")) return new URL(value).hostname;
  return value.replace(/\/.*$/, "");
}

// The Thank You page and the order status page write the order id differently,
// so only the final number is used. That way both pages see the same prize.
function orderNumber(orderId: string): string {
  const runs = String(orderId || "").match(/\d+/g);
  return runs ? runs[runs.length - 1] : "";
}

export type RewardForShopper = {
  id: string;
  kind: string;
  title: string;
  prize: { label: string; code: string };
};

export async function rewardsForOrder(
  domain: string,
  orderId: string,
): Promise<RewardForShopper[]> {
  const number = orderNumber(orderId);
  const shop = await prisma.shop.findUnique({ where: { domain } });
  const flags = shop as unknown as {
    killSwitch?: boolean;
    suspended?: boolean;
  } | null;

  // No shop, no order number, switched off or suspended: show nothing
  if (!shop || !number || flags?.killSwitch === true || flags?.suspended === true) {
    return [];
  }

  const orderKey = createHash("sha256")
    .update(`${shop.id}:${number}`)
    .digest("hex");

  const rewards = await prisma.reward.findMany({
    where: { shopId: shop.id, active: true },
    orderBy: { createdAt: "asc" },
    include: { prizes: { orderBy: { createdAt: "asc" } } },
  });

  const result: RewardForShopper[] = [];

  for (const reward of rewards) {
    if (reward.prizes.length === 0) continue;

    let play = await prisma.rewardPlay.findUnique({
      where: { rewardId_orderKey: { rewardId: reward.id, orderKey } },
    });

    if (!play) {
      const picked = pickPrize(reward.prizes);
      try {
        play = await prisma.rewardPlay.create({
          data: { rewardId: reward.id, orderKey, prizeId: picked.id },
        });
      } catch {
        // Two loads at the same moment: use whichever saved first
        play = await prisma.rewardPlay.findUnique({
          where: { rewardId_orderKey: { rewardId: reward.id, orderKey } },
        });
      }
    }
    if (!play) continue;

    let prize = reward.prizes.find((item) => item.id === play!.prizeId);
    if (!prize) {
      // The merchant removed that prize, so pick again
      prize = pickPrize(reward.prizes);
      await prisma.rewardPlay.update({
        where: { id: play.id },
        data: { prizeId: prize.id },
      });
    }

    result.push({
      id: reward.id,
      kind: reward.kind,
      title: reward.title,
      prize: { label: prize.label, code: prize.code ?? "" },
    });
  }

  return result;
}