import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import prisma from "../db.server";

const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000; // a token works for 24 hours
const SETTLEMENT_HOLD_MS = 24 * 60 * 60 * 1000; // credit is held 24 hours

// If the ad has a discount code, send the shopper through the store's
// built-in discount link so the code is already applied at checkout.
// Shopify supports: https://store.com/discount/CODE?redirect=/path
function withDiscount(destination: string, rawCode: string | null | undefined) {
  const code = (rawCode ?? "").trim();
  if (!code || code.length > 60) return destination;
  try {
    const url = new URL(destination);
    if (url.protocol !== "https:") return destination;
    const target = `${url.pathname}${url.search}` || "/";
    return `${url.origin}/discount/${encodeURIComponent(code)}?redirect=${encodeURIComponent(target)}`;
  } catch {
    return destination;
  }
}

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const token = String(params.token ?? "");

  const click = await prisma.click.findUnique({ where: { token } });
  if (!click) {
    throw new Response("Link not found", { status: 404 });
  }

  const ad = await prisma.ad.findUnique({ where: { id: click.adId } });
  if (!ad) {
    throw new Response("Link not found", { status: 404 });
  }

  // Single use: only the first visit can claim a pending token
  const now = new Date();
  await prisma.click.updateMany({
    where: {
      id: click.id,
      status: "pending",
      createdAt: { gte: new Date(now.getTime() - TOKEN_LIFETIME_MS) },
    },
    data: {
      status: "clicked",
      usedAt: now,
      settleAfter: new Date(now.getTime() + SETTLEMENT_HOLD_MS),
    },
  });

  // The shopper always gets sent on, whether or not the click counted
  const code = (ad as { code?: string | null }).code;
  return redirect(withDiscount(ad.destination, code));
};