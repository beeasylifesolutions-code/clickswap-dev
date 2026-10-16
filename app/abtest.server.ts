import { createHash } from "node:crypto";

export type Variant = "a" | "b";

type AbSlot = {
  id: string;
  title: string | null;
  imageUrl: string | null;
  priceText: string | null;
  productUrl: string | null;
  abActive: boolean;
  bTitle: string | null;
  bImageUrl: string | null;
  bPriceText: string | null;
  bProductUrl: string | null;
};

// Is an A/B test running on this slot? (needs both products)
export function testRunning(slot: AbSlot) {
  return Boolean(
    slot.abActive && slot.title && slot.bTitle && slot.bProductUrl,
  );
}

// 50/50 split. The same seed always gives the same answer,
// so reloading a page never switches the product.
export function chooseVariant(slot: AbSlot, seed: string): Variant | null {
  if (!testRunning(slot)) return null;
  const digest = createHash("sha256").update(`${slot.id}:${seed}`).digest();
  return digest[0] % 2 === 0 ? "a" : "b";
}

// The product details to show for a variant
export function productFor(slot: AbSlot, variant: Variant | null) {
  if (variant === "b") {
    return {
      title: slot.bTitle,
      imageUrl: slot.bImageUrl,
      priceText: slot.bPriceText,
      productUrl: slot.bProductUrl,
    };
  }
  return {
    title: slot.title,
    imageUrl: slot.imageUrl,
    priceText: slot.priceText,
    productUrl: slot.productUrl,
  };
}

// The link that counts a click. Adds the variant while a test is running.
export function trackedUrl(
  baseUrl: string,
  slotId: string,
  variant: Variant | null,
) {
  return `${baseUrl}/own/${slotId}${variant ? `?v=${variant}` : ""}`;
}