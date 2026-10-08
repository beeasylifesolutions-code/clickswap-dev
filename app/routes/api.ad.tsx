import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Handles the "preflight" check Shopify sends before the real request
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.checkout(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { cors, sessionToken } = await authenticate.public.checkout(request);
  const domain = String(sessionToken.dest).replace(/^https?:\/\//, "");

  // Only stores with swap on (and consent given) can show other stores' ads
  const me = await prisma.shop.findUnique({ where: { domain } });
  if (!me || !me.swapEnabled || !me.consentAt) {
    return cors(Response.json({ ad: null }));
  }

  const ads = await prisma.ad.findMany({
    where: {
      active: true,
      shop: {
        swapEnabled: true,
        consentAt: { not: null },
        domain: { not: domain },
      },
    },
    take: 50,
  });
  if (ads.length === 0) {
    return cors(Response.json({ ad: null }));
  }

  const ad = ads[Math.floor(Math.random() * ads.length)];
  return cors(
    Response.json({
      ad: {
        id: ad.id,
        title: ad.title,
        text: ad.text,
        code: ad.code,
        destination: ad.destination,
      },
    }),
  );
};