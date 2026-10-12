import prisma from "./db.server";

type AdminClient = {
  graphql: (query: string, options?: any) => Promise<Response>;
};

type Product = {
  gid: string;
  title: string;
  imageUrl: string | null;
  priceText: string | null;
  url: string;
};

const SURFACES = ["order_confirmation", "thank_you"] as const;

function formatPrice(amount: string, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
    }).format(Number(amount));
  } catch (error) {
    return `${amount} ${currency}`;
  }
}

// Reads the store's top 3 best-selling active products.
export async function fetchBestSellers(
  admin: AdminClient,
  domain: string,
): Promise<Product[]> {
  const response = await admin.graphql(
    `#graphql
    query BestSellers {
      products(first: 3, sortKey: BEST_SELLING, query: "status:active") {
        nodes {
          id
          title
          handle
          onlineStoreUrl
          featuredMedia {
            preview {
              image {
                url
              }
            }
          }
          priceRangeV2 {
            minVariantPrice {
              amount
              currencyCode
            }
          }
        }
      }
    }`,
  );
  const json = await response.json();
  const nodes = json?.data?.products?.nodes ?? [];
  return nodes.map((node: any) => ({
    gid: node.id,
    title: String(node.title || "").slice(0, 80),
    imageUrl: node.featuredMedia?.preview?.image?.url ?? null,
    priceText: node.priceRangeV2?.minVariantPrice
      ? formatPrice(
          node.priceRangeV2.minVariantPrice.amount,
          node.priceRangeV2.minVariantPrice.currencyCode,
        )
      : null,
    url: node.onlineStoreUrl || `https://${domain}/products/${node.handle}`,
  }));
}

// One-click setup for the 6 slots. Order Confirmation slots are your own
// products. Thank You slots are partner-ads-first with your own product as
// the fallback. A slot you already filled in is never overwritten.
export async function setupSlots(
  admin: AdminClient,
  domain: string,
  shopGid: string,
) {
  const shop = await prisma.shop.findUnique({ where: { domain } });
  if (!shop) return { ok: false, message: "Shop not found." };

  const products = await fetchBestSellers(admin, domain);
  if (products.length === 0) {
    return {
      ok: false,
      message: "Add at least one active product to your store first.",
    };
  }

  for (const surface of SURFACES) {
    for (let position = 1; position <= 3; position++) {
      const product = products[position - 1];
      if (!product) continue;
      const existing = await prisma.slot.findUnique({
        where: {
          shopId_surface_position: { shopId: shop.id, surface, position },
        },
      });
      if (existing && existing.title) continue;
      const data = {
        mode: surface === "order_confirmation" ? "self_promo" : "swap_first",
        active: true,
        productGid: product.gid,
        title: product.title,
        imageUrl: product.imageUrl,
        priceText: product.priceText,
        productUrl: product.url,
      };
      await prisma.slot.upsert({
        where: {
          shopId_surface_position: { shopId: shop.id, surface, position },
        },
        update: data,
        create: { shopId: shop.id, surface, position, ...data },
      });
    }
  }

  // Save a copy of the slots on the shop so the checkout blocks can read them fast
  await saveSlotsMetafield(admin, shop.id, shopGid);

  return { ok: true, message: "Slots filled" };
}

// Writes every slot into the shop metafield "slots" (read by the checkout blocks).
export async function saveSlotsMetafield(
  admin: AdminClient,
  shopDbId: string,
  shopGid: string,
) {
  const slots = await prisma.slot.findMany({
    where: { shopId: shopDbId, active: true },
    orderBy: [{ surface: "asc" }, { position: "asc" }],
  });
  const payload = slots.map((slot) => ({
    surface: slot.surface,
    position: slot.position,
    mode: slot.mode,
    title: slot.title,
    imageUrl: slot.imageUrl,
    priceText: slot.priceText,
    url: slot.productUrl,
  }));
  const response = await admin.graphql(
    `#graphql
    mutation SaveSlots($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors {
          message
        }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: shopGid,
            namespace: "$app",
            key: "slots",
            type: "json",
            value: JSON.stringify(payload),
          },
        ],
      },
    },
  );
  const json = await response.json();
  const errors = json?.data?.metafieldsSet?.userErrors ?? [];
  return errors.length > 0 ? (errors[0].message as string) : null;
}