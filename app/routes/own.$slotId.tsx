import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import prisma from "../db.server";

// Counts a click on one of a store's own products, then sends the customer
// to that product. The destination always comes from our own database.
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const slotId = String(params.slotId || "");
  const slot = slotId
    ? await prisma.slot.findUnique({ where: { id: slotId } })
    : null;
  if (!slot || !slot.productUrl) {
    return new Response("Not found", { status: 404 });
  }

  try {
    await prisma.ownEvent.create({
      data: {
        shopId: slot.shopId,
        surface: slot.surface,
        kind: "click",
        slotId: slot.id,
        title: slot.title,
      },
    });
  } catch {
    // counting must never stop the customer from reaching the product
  }

  return redirect(slot.productUrl);
};