import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { MAX_SLOTS } from "../swapads.server";
import prisma from "../db.server";

type Offer = {
  title: string;
  text?: string;
  code?: string;
  start?: string;
  end?: string;
};

const SAMPLE_OFFERS: Offer[] = [
  {
    title: "A thank-you gift for you",
    text: "Use code THANKYOU10 for 10% off your next order.",
    code: "",
  },
];

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

// Reads the store's own offers and on/off switch (saved by the settings page).
async function readOwnOffers(domain: string) {
  try {
    const { admin } = await unauthenticated.admin(domain);
    const response = await admin.graphql(
      `#graphql
      query {
        shop {
          enabled: metafield(namespace: "$app", key: "enabled") { value }
          offers: metafield(namespace: "$app", key: "offers") { value }
        }
      }`,
    );
    const json = await response.json();
    const shop = json?.data?.shop;
    const enabled = String(shop?.enabled?.value ?? "true") !== "false";

    let offers: Offer[] = SAMPLE_OFFERS;
    if (shop?.offers?.value) {
      const parsed = JSON.parse(shop.offers.value);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const today = todayString();
        offers = parsed
          .slice(0, MAX_SLOTS)
          .filter((offer: Offer) => offer && offer.title)
          .filter((offer: Offer) => !(offer.start && offer.start > today))
          .filter((offer: Offer) => !(offer.end && offer.end < today));
      }
    }
    return { enabled, offers };
  } catch (error) {
    return { enabled: true, offers: SAMPLE_OFFERS };
  }
}

// Reads the store's own product slots for the Order Confirmation page.
// Product links go through our server so clicks can be counted.
async function readProductSlots(domain: string, baseUrl: string) {
  try {
    const shop = await prisma.shop.findUnique({ where: { domain } });
    if (!shop) return { shopId: null, products: [] };
    const slots = await prisma.slot.findMany({
      where: { shopId: shop.id, surface: "order_confirmation", active: true },
      orderBy: { position: "asc" },
    });
    const products = slots
      .filter((slot) => slot.title)
      .map((slot) => ({
        slotId: slot.id,
        title: slot.title,
        imageUrl: slot.imageUrl,
        priceText: slot.priceText,
        url: slot.productUrl ? `${baseUrl}/own/${slot.id}` : null,
      }));
    return { shopId: shop.id, products };
  } catch (error) {
    return { shopId: null, products: [] };
  }
}

// Handles the "preflight" check Shopify sends before the real request
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.customerAccount(request);
  return null;
};

// The Order Confirmation page shows only the store's own products and offers.
// Partner swap ads appear on the Thank You page only.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { cors, sessionToken } =
    await authenticate.public.customerAccount(request);
  const domain = String(sessionToken.dest).replace(/^https?:\/\//, "");

  const { enabled, offers } = await readOwnOffers(domain);
  if (!enabled) {
    return cors(Response.json({ ads: [], products: [], offers: [] }));
  }

  const baseUrl =
    // eslint-disable-next-line no-undef
    process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
  const { shopId, products } = await readProductSlots(domain, baseUrl);

  // Count one view for each own product shown. Never let this break the page.
  try {
    if (shopId && products.length > 0) {
      await prisma.ownEvent.createMany({
        data: products.map((product) => ({
          shopId,
          surface: "order_confirmation",
          kind: "view",
          slotId: product.slotId,
          title: product.title,
        })),
      });
    }
  } catch {
    // analytics must never stop the page from loading
  }

  return cors(Response.json({ ads: [], products, offers }));
};