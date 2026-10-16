import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import prisma from "../db.server";

// Counts a click on one of a store's own products, then sends the customer
// to that product. The destination always comes from our own database.
// During an A/B test the link carries ?v=a or ?v=b so the click is credited
// to the right product.
export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const slotId = String(params.slotId || "");
  const slot = slotId
    ? await prisma.slot.findUnique({ where: { id: slotId } })
    : null;
  if (!slot || !slot.productUrl) {
    return new Response("Not found", { status: 404 });
  }

  const asked = new URL(request.url).searchParams.get("v");
  const useB = asked === "b" && Boolean(slot.bProductUrl);
  const variant = useB ? "b" : asked === "a" ? "a" : null;
  const destination = useB ? (slot.bProductUrl as string) : slot.productUrl;
  const title = useB ? slot.bTitle : slot.title;

  try {
    await prisma.ownEvent.create({
      data: {
        shopId: slot.shopId,
        surface: slot.surface,
        kind: "click",
        slotId: slot.id,
        title,
        variant,
      },
    });
  } catch {
    // counting must never stop the customer from reaching the product
  }

  return redirect(destination);
};