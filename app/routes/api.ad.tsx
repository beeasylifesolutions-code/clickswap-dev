import { randomBytes } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { meetsMinimum } from "../orders.server";

// Handles the "preflight" check Shopify sends before the real request
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.checkout(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { cors, sessionToken } = await authenticate.public.checkout(request);
  const domain = String(sessionToken.dest).replace(/^https?:\/\//, "");

  // Only stores with swap on, consent given and enough paid orders
  // can show other stores' ads
  const me = await prisma.shop.findUnique({ where: { domain } });
  if (
    !me ||
    !me.swapEnabled ||
    !me.consentAt ||
    !meetsMinimum(me.ordersLast30)
  ) {
    return cors(Response.json({ ad: null }));
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

  if (ads.length === 0) {
    return cors(Response.json({ ad: null }));
  }

  const ad = ads[Math.floor(Math.random() * ads.length)];

  // One single-use token per ad shown
  const token = randomBytes(24).toString("hex");
  await prisma.click.create({
    data: {
      token,
      adId: ad.id,
      senderShopId: me.id,
      advertiserShopId: ad.shopId,
    },
  });

  return cors(
    Response.json({
      ad: {
        id: ad.id,
        title: ad.title,
        text: ad.text,
        code: ad.code,
        token,
      },
    }),
  );
};