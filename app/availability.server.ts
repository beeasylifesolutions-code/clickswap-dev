import prisma from "./db.server";
import { unauthenticated } from "./shopify.server";

// How many stores are checked each time the 10-minute job runs
const SHOPS_PER_RUN = 10;

// Ads paused by this check always start with this text, so only they are
// switched back on by it (ads paused because of reports stay paused).
const REASON_PREFIX = "Product unavailable";

type Verdict = { available: boolean; why: string };

// Looks at one product's state in Shopify
function judge(node: any): Verdict {
  if (!node) return { available: false, why: "the product was deleted" };
  if (node.status !== "ACTIVE") {
    return { available: false, why: "the product is not active" };
  }
  const sellsWhenEmpty = (node.variants?.nodes ?? []).some(
    (variant: any) => variant.inventoryPolicy === "CONTINUE",
  );
  if (
    node.tracksInventory &&
    typeof node.totalInventory === "number" &&
    node.totalInventory <= 0 &&
    !sellsWhenEmpty
  ) {
    return { available: false, why: "the product is out of stock" };
  }
  return { available: true, why: "" };
}

// Pauses live partner ads whose product is deleted, inactive or out of stock,
// and switches them back on when the product is available again.
export async function checkProductAvailability() {
  const ads = await prisma.ad.findMany({
    where: {
      productGid: { not: null },
      active: true,
      shop: { swapEnabled: true },
    },
    select: {
      id: true,
      productGid: true,
      disabled: true,
      disabledReason: true,
      shop: { select: { domain: true } },
    },
  });

  const byShop = new Map<string, typeof ads>();
  for (const ad of ads) {
    const list = byShop.get(ad.shop.domain) ?? [];
    list.push(ad);
    byShop.set(ad.shop.domain, list);
  }

  // A random handful of stores each run, so every store is reached over time
  const domains = [...byShop.keys()]
    .sort(() => Math.random() - 0.5)
    .slice(0, SHOPS_PER_RUN);

  let paused = 0;
  let resumed = 0;

  for (const domain of domains) {
    const shopAds = byShop.get(domain) ?? [];
    try {
      const { admin } = await unauthenticated.admin(domain);
      const ids = [...new Set(shopAds.map((ad) => ad.productGid as string))];
      const response = await admin.graphql(
        `#graphql
        query Availability($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              status
              tracksInventory
              totalInventory
              variants(first: 50) {
                nodes {
                  inventoryPolicy
                }
              }
            }
          }
        }`,
        { variables: { ids } },
      );
            const json: any = await response.json();
      if (json.errors || !Array.isArray(json.data?.nodes)) continue;

      const verdicts = new Map<string, Verdict>();
      ids.forEach((id, index) => {
        verdicts.set(id, judge(json.data.nodes[index]));
      });

      for (const ad of shopAds) {
        const verdict = verdicts.get(ad.productGid as string);
        if (!verdict) continue;
        const ours = (ad.disabledReason ?? "").startsWith(REASON_PREFIX);

        if (!verdict.available && !ad.disabled) {
          await prisma.ad.update({
            where: { id: ad.id },
            data: {
              disabled: true,
              disabledReason: `${REASON_PREFIX}: ${verdict.why}. It switches back on by itself when the product is available again.`,
            },
          });
          paused += 1;
        } else if (verdict.available && ad.disabled && ours) {
          await prisma.ad.update({
            where: { id: ad.id },
            data: { disabled: false, disabledReason: null },
          });
          resumed += 1;
        }
      }
    } catch (error) {
      // A store that cannot be reached (for example, uninstalled) is skipped
      console.error("Availability check failed for", domain, error);
    }
  }

  return { checked: domains.length, paused, resumed };
}