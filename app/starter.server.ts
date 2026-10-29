import prisma from "./db.server";
import { meetsMinimum } from "./orders.server";

// One-time gift so a new store's ads can start showing before it has earned
// its first credit. Credits only buy visitors inside the network.
export const STARTER_CREDITS = 3;

// Gives the store its starter credits once, if it qualifies:
// swap on with consent, no kill switch or suspension, and at least the order
// minimum. Development (test) stores are skipped, except while the temporary
// setting DEV_STORE_TESTING=true is on Render for testing.
export async function grantStarterCredits(shopId: string) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) return false;

  // eslint-disable-next-line no-undef
  const devTesting = process.env.DEV_STORE_TESTING === "true";

  if (!shop.swapEnabled || !shop.consentAt) return false;
  if (shop.killSwitch || shop.suspended) return false;
  if (shop.isDevStore && !devTesting) return false;
  if (!shop.isDevStore && !meetsMinimum(shop.ordersLast30)) return false;

  const already = await prisma.creditLedger.findFirst({
    where: { shopId, reason: "starter_credit" },
    select: { id: true },
  });
  if (already) return false;

  await prisma.creditLedger.create({
    data: { shopId, delta: STARTER_CREDITS, reason: "starter_credit" },
  });
  return true;
}