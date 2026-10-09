import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const HOUR = 60 * 60 * 1000;

async function periodStats(shopId: string, since: Date) {
  const [shownOnMyPage, myAdShown, clicksSent, clicksReceived] =
    await Promise.all([
      prisma.click.count({
        where: { senderShopId: shopId, createdAt: { gte: since } },
      }),
      prisma.click.count({
        where: { advertiserShopId: shopId, createdAt: { gte: since } },
      }),
      prisma.click.count({
        where: { senderShopId: shopId, usedAt: { gte: since } },
      }),
      prisma.click.count({
        where: { advertiserShopId: shopId, usedAt: { gte: since } },
      }),
    ]);
  const clickRate =
    shownOnMyPage > 0
      ? `${((clicksSent / shownOnMyPage) * 100).toFixed(1)}%`
      : "-";
  return { shownOnMyPage, myAdShown, clicksSent, clicksReceived, clickRate };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });

  const now = Date.now();
  const [balance, pendingEarned, pendingSpent, day, week, month, recent] =
    await Promise.all([
      prisma.creditLedger.aggregate({
        where: { shopId: shop.id },
        _sum: { delta: true },
      }),
      prisma.click.count({
        where: { senderShopId: shop.id, status: "clicked" },
      }),
      prisma.click.count({
        where: { advertiserShopId: shop.id, status: "clicked" },
      }),
      periodStats(shop.id, new Date(now - 24 * HOUR)),
      periodStats(shop.id, new Date(now - 7 * 24 * HOUR)),
      periodStats(shop.id, new Date(now - 30 * 24 * HOUR)),
      prisma.click.findMany({
        where: {
          usedAt: { not: null },
          OR: [{ senderShopId: shop.id }, { advertiserShopId: shop.id }],
        },
        orderBy: { usedAt: "desc" },
        take: 5,
      }),
    ]);

  const adIds = [...new Set(recent.map((click) => click.adId))];
  const ads = await prisma.ad.findMany({ where: { id: { in: adIds } } });
  const titles = new Map(ads.map((ad) => [ad.id, ad.title]));

  return {
    balance: balance._sum.delta ?? 0,
    pendingEarned,
    pendingSpent,
    periods: [
      { label: "Last 24 hours", ...day },
      { label: "Last 7 days", ...week },
      { label: "Last 30 days", ...month },
    ],
    recent: recent.map((click) => ({
      id: click.id,
      direction: click.senderShopId === shop.id ? "Sent" : "Received",
      title: titles.get(click.adId) ?? "Ad",
      when: click.usedAt
        ? click.usedAt.toISOString().slice(0, 16).replace("T", " ") + " UTC"
        : "",
      status: click.status,
    })),
  };
};

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page heading="Dashboard">
      <s-stack direction="block" gap="base">
        <s-section heading="Credits">
          <s-stack direction="block" gap="small">
            <s-text type="strong">Balance: {data.balance} credits</s-text>
            <s-text>
              Waiting in the 24-hour hold: +{data.pendingEarned} earned, -
              {data.pendingSpent} to be spent
            </s-text>
          </s-stack>
        </s-section>

        {data.periods.map((period) => (
          <s-section key={period.label} heading={period.label}>
            <s-stack direction="block" gap="small">
              <s-text>
                Ads shown on your Thank you page: {period.shownOnMyPage}
              </s-text>
              <s-text>Clicks you sent to other stores: {period.clicksSent}</s-text>
              <s-text>Click rate on your page: {period.clickRate}</s-text>
              <s-text>Your ad shown on other stores: {period.myAdShown}</s-text>
              <s-text>
                Clicks you received from other stores: {period.clicksReceived}
              </s-text>
            </s-stack>
          </s-section>
        ))}

        <s-section heading="Recent clicks">
          <s-stack direction="block" gap="small">
            {data.recent.length === 0 ? (
              <s-text>No clicks yet.</s-text>
            ) : (
              data.recent.map((click) => (
                <s-text key={click.id}>
                  {click.direction}: {click.title} ({click.when}, {click.status})
                </s-text>
              ))
            )}
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}