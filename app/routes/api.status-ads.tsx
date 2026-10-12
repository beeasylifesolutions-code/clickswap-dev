import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate, unauthenticated } from "../shopify.server";
import { MAX_SLOTS } from "../swapads.server";

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

// Handles the "preflight" check Shopify sends before the real request
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.customerAccount(request);
  return null;
};

// The Order Confirmation page shows only the store's own offers.
// Partner swap ads appear on the Thank You page only.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { cors, sessionToken } =
    await authenticate.public.customerAccount(request);
  const domain = String(sessionToken.dest).replace(/^https?:\/\//, "");

  const { enabled, offers } = await readOwnOffers(domain);
  if (!enabled) {
    return cors(Response.json({ ads: [], offers: [] }));
  }

  return cors(Response.json({ ads: [], offers }));
};