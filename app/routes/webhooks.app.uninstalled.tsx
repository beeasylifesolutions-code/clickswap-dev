import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// When a store uninstalls: remove its login sessions, switch swap off and pause its ads
// so partner stores stop showing them. Full deletion comes later via the shop/redact notice.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  await prisma.session.deleteMany({ where: { shop } });

  const record = await prisma.shop.findUnique({ where: { domain: shop } });
  if (record) {
    await prisma.shop.update({
      where: { id: record.id },
      data: { swapEnabled: false },
    });
    await prisma.ad.updateMany({
      where: { shopId: record.id },
      data: { active: false },
    });
  }

  return new Response();
};