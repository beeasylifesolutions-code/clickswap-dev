import prisma from "./db.server";

export const MINIMUM_ORDERS = 50;

// Asks Shopify how many paid, non-test orders the store had in the last 30 days
// and saves the number on the Shop row.
export async function refreshOrderCount(admin: any, domain: string) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const response = await admin.graphql(
    `#graphql
    query PaidOrders($query: String!) {
      ordersCount(query: $query, limit: 5000) {
        count
      }
    }`,
    {
      variables: {
        query: `financial_status:paid test:false created_at:>=${since}`,
      },
    },
  );

  const json = await response.json();
  if (json.errors) {
    throw new Error("Order count failed: " + JSON.stringify(json.errors));
  }

  const count: number = json?.data?.ordersCount?.count ?? 0;

  await prisma.shop.update({
    where: { domain },
    data: { ordersLast30: count, ordersCheckedAt: new Date() },
  });

  return count;
}

// Asks Shopify whether this is a development (test) store and saves the answer.
// Development stores are the ones Shopify's reviewers and developers use.
// If Shopify cannot be reached, the saved answer is kept.
export async function refreshDevStoreFlag(admin: any, domain: string) {
  try {
    const response = await admin.graphql(
      `#graphql
      query {
        shop {
          plan {
            partnerDevelopment
          }
        }
      }`,
    );
    const json = await response.json();
    const flag = json?.data?.shop?.plan?.partnerDevelopment;
    if (typeof flag === "boolean") {
      await prisma.shop.update({
        where: { domain },
        data: { isDevStore: flag },
      });
      return flag;
    }
  } catch (error) {
    console.error(error);
  }
  const saved = await prisma.shop.findUnique({
    where: { domain },
    select: { isDevStore: true },
  });
  return saved?.isDevStore ?? false;
}

// True if the store may use swap ads.
// SKIP_ORDER_MINIMUM=true is only for testing on the dev store.
export function meetsMinimum(count: number) {
  if (process.env.SKIP_ORDER_MINIMUM === "true") return true;
  return count >= MINIMUM_ORDERS;
}