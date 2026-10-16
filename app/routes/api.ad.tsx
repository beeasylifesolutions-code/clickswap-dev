import { createHash, randomUUID } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { pickSwapAds } from "../swapads.server";
import { chooseVariant, productFor, trackedUrl } from "../abtest.server";
import prisma from "../db.server";

// Handles the "preflight" check Shopify sends before the real request
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.checkout(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { cors, sessionToken } = await authenticate.public.checkout(request);
  const domain = String(sessionToken.dest).replace(/^https?:\/\//, "");

  // The order this page belongs to (not sent in the checkout editor preview)
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  const orderId =
    body && typeof body.orderId === "string" && body.orderId
      ? body.orderId
      : null;

  // Partner ads (already limited by caps, blocklists, kill switch and so on)
  const ads = await pickSwapAds(domain, orderId);

  // Image and price for each partner ad
  const extra =
    ads.length > 0
      ? await prisma.ad.findMany({
          where: { id: { in: ads.map((ad) => ad.id) } },
          select: { id: true, imageUrl: true, priceText: true },
        })
      : [];
  const extraById = new Map(extra.map((row) => [row.id, row]));
  const partners = ads.map((ad) => ({
    kind: "partner",
    title: ad.title,
    text: ad.text,
    code: ad.code,
    token: ad.token,
    imageUrl: extraById.get(ad.id)?.imageUrl ?? null,
    priceText: extraById.get(ad.id)?.priceText ?? null,
  }));

  // This store's own Thank You slots
  const shop = await prisma.shop.findUnique({ where: { domain } });
  const slots = shop
    ? await prisma.slot.findMany({
        where: { shopId: shop.id, surface: "thank_you", active: true },
        orderBy: { position: "asc" },
      })
    : [];

  // Own product links go through our server so clicks can be counted
  const baseUrl =
    // eslint-disable-next-line no-undef
    process.env.SHOPIFY_APP_URL || new URL(request.url).origin;

  // Each slot shows a partner ad when it is set to swap and one is available,
  // and otherwise the store's own product, so a slot is never empty.
  // If an A/B test runs on a slot, the order decides whether it shows A or B.
  const items: any[] = [];
  if (slots.length === 0) {
    items.push(...partners.slice(0, 3));
  } else {
    let next = 0;
    for (const slot of slots) {
      if (slot.mode !== "self_promo" && next < partners.length) {
        items.push(partners[next]);
        next += 1;
        continue;
      }
      if (slot.title) {
        const variant = chooseVariant(slot, orderId ?? randomUUID());
        const shown = productFor(slot, variant);
        items.push({
          kind: "own",
          slotId: slot.id,
          variant,
          title: shown.title,
          imageUrl: shown.imageUrl,
          priceText: shown.priceText,
          url: shown.productUrl ? trackedUrl(baseUrl, slot.id, variant) : null,
        });
      }
    }
  }

  // Count one view of the own products per order. Never let this break the page.
  try {
    const ownShown = items.filter((item) => item.kind === "own");
    if (shop && orderId && ownShown.length > 0) {
      const orderKey = createHash("sha256")
        .update(`${shop.id}:${orderId}`)
        .digest("hex");
      const seen = await prisma.ownEvent.findFirst({
        where: { shopId: shop.id, surface: "thank_you", kind: "view", orderKey },
      });
      if (!seen) {
        await prisma.ownEvent.createMany({
          data: ownShown.map((item) => ({
            shopId: shop.id,
            surface: "thank_you",
            kind: "view",
            slotId: item.slotId,
            title: item.title,
            variant: item.variant ?? null,
            orderKey,
          })),
        });
      }
    }
  } catch {
    // analytics must never stop the page from loading
  }

  return cors(Response.json({ ads, items }));
};