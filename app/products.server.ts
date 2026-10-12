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

const PRODUCT_FIELDS = `
  id
  title
  handle
  status
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
`;

function toProduct(node: any, domain: string): Product {
  return {
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
  };
}

// Finds the store's top 3 products. Best sellers come from recent paid orders.
// If there are not enough sales yet, other active products fill the gaps.
export async function fetchBestSellers(
  admin: AdminClient,
  domain: string,
): Promise<Product[]> {
  // Step 1: count units sold per product in recent paid orders
  const sold = new Map<string, number>();
  try {
    const ordersResponse = await admin.graphql(
      `#graphql
      query RecentOrders {
        orders(first: 100, sortKey: CREATED_AT, reverse: true, query: "financial_status:paid test:false") {
          nodes {
            lineItems(first: 50) {
              nodes {
                quantity
                product {
                  id
                }
              }
            }
          }
        }
      }`,
    );
    const ordersJson = await ordersResponse.json();
    const orders = ordersJson?.data?.orders?.nodes ?? [];
    for (const order of orders) {
      for (const item of order.lineItems?.nodes ?? []) {
        const id = item.product?.id;
        if (!id) continue;
        sold.set(id, (sold.get(id) ?? 0) + (item.quantity ?? 1));
      }
    }
  } catch (error) {
    console.error("Could not read recent orders", error);
  }

  const topIds = [...sold.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => id);

  const result: Product[] = [];
  const seen = new Set<string>();

  // Step 2: load those products (active only), in best-seller order
  if (topIds.length > 0) {
    const response = await admin.graphql(
      `#graphql
      query TopProducts($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            ${PRODUCT_FIELDS}
          }
        }
      }`,
      { variables: { ids: topIds } },
    );
    const json = await response.json();
    const nodes = (json?.data?.nodes ?? []).filter(
      (node: any) => node && node.id && node.status === "ACTIVE",
    );
    const byId = new Map<string, any>(nodes.map((n: any) => [n.id, n]));
    for (const id of topIds) {
      const node = byId.get(id);
      if (!node || seen.has(id)) continue;
      seen.add(id);
      result.push(toProduct(node, domain));
      if (result.length === 3) return result;
    }
  }

  // Step 3: fill any empty spots with other active products
  const fillResponse = await admin.graphql(
    `#graphql
    query FillProducts {
      products(first: 10, sortKey: UPDATED_AT, reverse: true, query: "status:active") {
        nodes {
          ${PRODUCT_FIELDS}
        }
      }
    }`,
  );
  const fillJson = await fillResponse.json();
  for (const node of fillJson?.data?.products?.nodes ?? []) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    result.push(toProduct(node, domain));
    if (result.length === 3) break;
  }
  return result;
}

// Turns each Thank You slot product into a network ad (with image and price).
// An ad that already exists for a product is left alone.
export async function syncProductAds(shopDbId: string) {
  const slots = await prisma.slot.findMany({
    where: { shopId: shopDbId, surface: "thank_you", active: true },
  });
  for (const slot of slots) {
    if (!slot.productGid || !slot.title || !slot.productUrl) continue;
    if (!slot.productUrl.startsWith("https://")) continue;
    const existing = await prisma.ad.findFirst({
      where: { shopId: shopDbId, productGid: slot.productGid },
    });
    if (existing) continue;
    await prisma.ad.create({
      data: {
        shopId: shopDbId,
        title: slot.title,
        text: "A best seller from this store.",
        destination: slot.productUrl,
        imageUrl: slot.imageUrl,
        priceText: slot.priceText,
        productGid: slot.productGid,
        active: true,
      },
    });
  }
}

// One-click setup for the 6 slots. Order Confirmation slots are your own
// products. Thank You slots are partner-ads-first with your own product as
// the fallback. A slot you already filled in is never overwritten.
export async function setupSlots(
  admin: AdminClient,
  domain: string,
  shopGid: string,
) {
  try {
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

    // The Thank You products also become this store's network ads
    await syncProductAds(shop.id);

    // Save a copy of the slots on the shop so the checkout blocks can read them fast
    await saveSlotsMetafield(admin, shop.id, shopGid);

    return { ok: true, message: "Slots filled" };
  } catch (error) {
    console.error("Slot setup failed", error);
    return {
      ok: false,
      message: "Could not fill your slots. Please try again in a minute.",
    };
  }
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