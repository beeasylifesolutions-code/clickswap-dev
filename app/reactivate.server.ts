import prisma from "./db.server";

// Turns a store's network ads back on for the products that are currently in
// its Thank You slots (and off for products that are not). Used when a store
// turns swap on, for example after an uninstall and reinstall.
export async function reactivateAds(shopId: string) {
  const slots = await prisma.slot.findMany({
    where: { shopId, surface: "thank_you", productGid: { not: null } },
    select: { productGid: true },
  });
  const gids = slots.map((slot) => slot.productGid as string);
  await prisma.ad.updateMany({
    where: { shopId, productGid: { not: null, notIn: gids } },
    data: { active: false },
  });
  if (gids.length > 0) {
    await prisma.ad.updateMany({
      where: { shopId, productGid: { in: gids } },
      data: { active: true },
    });
  }
}