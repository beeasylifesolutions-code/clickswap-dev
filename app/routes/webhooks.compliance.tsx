import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Shopify's three mandatory privacy notices.
// We store no customer data, so the two customer notices need no action.
// The shop notice (sent ~48 hours after uninstall) deletes everything we hold for that store.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticate.webhook(request);
  const name = String(topic).toUpperCase().replace(/[\/]/g, "_");

  switch (name) {
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
      console.log(`Received ${name} for ${shop}: no customer data stored`);
      break;
    case "SHOP_REDACT": {
      await prisma.session.deleteMany({ where: { shop } });
      const record = await prisma.shop.findUnique({
        where: { domain: shop },
        select: { id: true },
      });
      if (record) {
        // These tables are not linked to Shop in the database, so delete them
        // here. Prizes, plays and survey answers go with them.
        await prisma.reward.deleteMany({ where: { shopId: record.id } });
        await prisma.survey.deleteMany({ where: { shopId: record.id } });
        // Everything else (slots, ads, clicks, credits, pins, blocks, reports,
        // own-product events) is deleted with the shop automatically.
        await prisma.shop.delete({ where: { id: record.id } });
      }
      console.log(`Received SHOP_REDACT for ${shop}: data deleted`);
      break;
    }
    default:
      console.log(`Received ${name} for ${shop}`);
  }

  return new Response();
};