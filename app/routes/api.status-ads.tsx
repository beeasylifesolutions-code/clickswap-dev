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
async function readProductSlots(domain: string) {
  try {
    const shop = await prisma.shop.findUnique({ where: { domain } });
    if (!shop) return [];
    const slots = await prisma.slot.findMany({
      where: { shopId: shop.id, surface: "order_confirmation", active: true },
      orderBy: { position: "asc" },
    });
    return slots
      .filter((slot) => slot.title)
      .map((slot) => ({
        title: slot.title,
        imageUrl: slot.imageUrl,
        priceText: slot.priceText,
        url: slot.productUrl,
      }));
  } catch (error) {
    return [];
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

  const products = await readProductSlots(domain);
  return cors(Response.json({ ads: [], products, offers }));
};