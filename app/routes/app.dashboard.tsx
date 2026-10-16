import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const DAY = 24 * 60 * 60 * 1000;

// Same numbers as the ad picker (plans: 1 Starter, 2 Growth, 3 Scale, 4 Enterprise)
const DAILY_VIEW_CAP: Record<number, number> = { 1: 15, 2: 60, 3: 200, 4: 1000 };
const DAILY_CLICK_CAP: Record<number, number> = { 1: 1, 2: 3, 3: 10, 4: 50 };
const PLAN_NAMES: Record<number, string> = {
  1: "Starter",
  2: "Growth",
  3: "Scale",
  4: "Enterprise",
};

const SURFACE_NAMES: Record<string, string> = {
  thank_you: "Thank You page",
  order_confirmation: "Order Confirmation page",
};

// A/B tests need this many views on each product before we name a winner
const AB_MIN_VIEWS = 50;

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

const pct = (clicks: number, views: number) =>
  views > 0 ? `${((clicks / views) * 100).toFixed(1)}%` : "-";

type Side = { views: number; clicks: number };

// Plain-language result of an A/B test (two-proportion check, 95% confidence)
function abVerdict(a: Side, b: Side) {
  if (a.views < AB_MIN_VIEWS || b.views < AB_MIN_VIEWS) {
    return `Too early to call. Each product needs at least ${AB_MIN_VIEWS} views (A has ${a.views}, B has ${b.views}).`;
  }
  const pa = a.clicks / a.views;
  const pb = b.clicks / b.views;
  const pooled = (a.clicks + b.clicks) / (a.views + b.views);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.views + 1 / b.views));
  if (se === 0) return "No clicks yet on either product.";
  const z = (pa - pb) / se;
  if (Math.abs(z) < 1.96) {
    return "No clear winner yet. The difference could still be chance.";
  }
  return `${pa > pb ? "Product A" : "Product B"} is winning, and it is unlikely to be chance.`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });

  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("days"));
  const days = [7, 30, 90].includes(requested) ? requested : 30;
  const now = Date.now();
  const since = new Date(now - days * DAY);

  const [
    balance,
    pendingEarned,
    pendingSpent,
    clicks,
    recent,
    ownEvents,
    runningSlots,
  ] = await Promise.all([
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
    prisma.click.findMany({
      where: {
        createdAt: { gte: since },
        OR: [{ senderShopId: shop.id }, { advertiserShopId: shop.id }],
      },
      select: {
        createdAt: true,
        usedAt: true,
        viewId: true,
        senderShopId: true,
        advertiserShopId: true,
      },
      take: 100000,
    }),
    prisma.click.findMany({
      where: {
        usedAt: { not: null },
        OR: [{ senderShopId: shop.id }, { advertiserShopId: shop.id }],
      },
      orderBy: { usedAt: "desc" },
      take: 5,
    }),
    prisma.ownEvent.findMany({
      where: { shopId: shop.id, createdAt: { gte: since } },
      select: {
        surface: true,
        kind: true,
        title: true,
        slotId: true,
        variant: true,
        createdAt: true,
      },
      take: 100000,
    }),
    prisma.slot.findMany({
      where: { shopId: shop.id, abActive: true },
      select: { id: true },
    }),
  ]);

  // Every day in the period, oldest first
  const labels: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    labels.push(dayKey(new Date(now - i * DAY)));
  }
  const viewSets = new Map<string, Set<string>>();
  const sent = new Map<string, number>();
  const received = new Map<string, number>();
  let shownOnOthers = 0;

  for (const click of clicks) {
    if (click.senderShopId === shop.id) {
      if (click.viewId) {
        const key = dayKey(click.createdAt);
        if (!viewSets.has(key)) viewSets.set(key, new Set());
        viewSets.get(key)!.add(click.viewId);
      }
      if (click.usedAt) {
        const key = dayKey(click.usedAt);
        sent.set(key, (sent.get(key) ?? 0) + 1);
      }
    }
    if (click.advertiserShopId === shop.id) {
      shownOnOthers += 1;
      if (click.usedAt) {
        const key = dayKey(click.usedAt);
        received.set(key, (received.get(key) ?? 0) + 1);
      }
    }
  }

  const viewsSeries = labels.map((label) => viewSets.get(label)?.size ?? 0);
  const sentSeries = labels.map((label) => sent.get(label) ?? 0);
  const receivedSeries = labels.map((label) => received.get(label) ?? 0);
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const totalViews = sum(viewsSeries);
  const totalSent = sum(sentSeries);
  const totalReceived = sum(receivedSeries);

  // Own products: views and clicks, in total and for each product
  const ownViewDay = new Map<string, number>();
  const ownByProduct = new Map<string, { views: number; clicks: number }>();
  let ownViews = 0;
  let ownClicks = 0;

  // A/B tests: views and clicks for A and B on each slot
  const abBySlot = new Map<
    string,
    {
      surface: string;
      a: Side & { title: string };
      b: Side & { title: string };
    }
  >();

  for (const event of ownEvents) {
    const name = event.title ?? "Product";
    const entry = ownByProduct.get(name) ?? { views: 0, clicks: 0 };
    if (event.kind === "view") {
      entry.views += 1;
      ownViews += 1;
      const key = dayKey(event.createdAt);
      ownViewDay.set(key, (ownViewDay.get(key) ?? 0) + 1);
    } else if (event.kind === "click") {
      entry.clicks += 1;
      ownClicks += 1;
    }
    ownByProduct.set(name, entry);

    if (event.slotId && (event.variant === "a" || event.variant === "b")) {
      const group = abBySlot.get(event.slotId) ?? {
        surface: event.surface,
        a: { views: 0, clicks: 0, title: "" },
        b: { views: 0, clicks: 0, title: "" },
      };
      const side = event.variant === "a" ? group.a : group.b;
      if (event.kind === "view") side.views += 1;
      else if (event.kind === "click") side.clicks += 1;
      if (!side.title && event.title) side.title = event.title;
      abBySlot.set(event.slotId, group);
    }
  }
  const ownViewsSeries = labels.map((label) => ownViewDay.get(label) ?? 0);
  const ownProducts = Array.from(ownByProduct.entries())
    .map(([title, entry]) => ({
      title,
      views: entry.views,
      clicks: entry.clicks,
      rate: pct(entry.clicks, entry.views),
    }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);

  const runningIds = new Set(runningSlots.map((slot) => slot.id));
  const abTests = Array.from(abBySlot.entries()).map(([slotId, group]) => ({
    slotId,
    page: SURFACE_NAMES[group.surface] ?? group.surface,
    running: runningIds.has(slotId),
    aTitle: group.a.title || "Product A",
    bTitle: group.b.title || "Product B",
    aViews: group.a.views,
    aClicks: group.a.clicks,
    aRate: pct(group.a.clicks, group.a.views),
    bViews: group.b.views,
    bClicks: group.b.clicks,
    bRate: pct(group.b.clicks, group.b.views),
    verdict: abVerdict(group.a, group.b),
  }));

  const today = dayKey(new Date(now));
  const plan = shop.plan ?? 1;

  const adIds = [...new Set(recent.map((click) => click.adId))];
  const ads = await prisma.ad.findMany({ where: { id: { in: adIds } } });
  const titles = new Map(ads.map((ad) => [ad.id, ad.title]));

  return {
    days,
    balance: balance._sum.delta ?? 0,
    pendingEarned,
    pendingSpent,
    labels,
    viewsSeries,
    sentSeries,
    receivedSeries,
    totalViews,
    totalSent,
    totalReceived,
    shownOnOthers,
    clickRate: pct(totalSent, totalViews),
    ownViews,
    ownClicks,
    ownClickRate: pct(ownClicks, ownViews),
    ownViewsSeries,
    ownProducts,
    abTests,
    planName: PLAN_NAMES[plan] ?? "Starter",
    viewsToday: viewSets.get(today)?.size ?? 0,
    clicksToday: sent.get(today) ?? 0,
    viewCap: DAILY_VIEW_CAP[plan] ?? DAILY_VIEW_CAP[1],
    clickCap: DAILY_CLICK_CAP[plan] ?? DAILY_CLICK_CAP[1],
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

function BarChart({
  values,
  labels,
  title,
}: {
  values: number[];
  labels: string[];
  title: string;
}) {
  const max = Math.max(1, ...values);
  const width = 600;
  const height = 120;
  const step = width / Math.max(1, values.length);
  const barWidth = Math.max(1, step - 2);
  return (
    <svg
      viewBox={`0 0 ${width} ${height + 18}`}
      width="100%"
      role="img"
      aria-label={title}
    >
      <line
        x1="0"
        y1={height}
        x2={width}
        y2={height}
        stroke="currentColor"
        opacity="0.25"
      />
      {values.map((value, index) => {
        const barHeight = (value / max) * height;
        return (
          <rect
            key={index}
            x={index * step}
            y={height - barHeight}
            width={barWidth}
            height={barHeight}
            fill="currentColor"
            opacity="0.7"
          >
            <title>{`${labels[index]}: ${value}`}</title>
          </rect>
        );
      })}
      <text x="0" y={height + 14} fontSize="11" fill="currentColor">
        {labels[0]}
      </text>
      <text
        x={width}
        y={height + 14}
        fontSize="11"
        fill="currentColor"
        textAnchor="end"
      >
        {labels[labels.length - 1]}
      </text>
    </svg>
  );
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <s-box border="base" borderRadius="base" padding="base">
      <s-stack gap="small">
        <s-text>{label}</s-text>
        <s-heading>{String(value)}</s-heading>
      </s-stack>
    </s-box>
  );
}

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page heading="Dashboard">
      <s-stack direction="block" gap="base">
        <s-section heading="Time period">
          <s-stack direction="inline" gap="base">
            {[7, 30, 90].map((option) => (
              <s-link key={option} href={`/app/dashboard?days=${option}`}>
                {option === data.days
                  ? `Last ${option} days (showing)`
                  : `Last ${option} days`}
              </s-link>
            ))}
          </s-stack>
        </s-section>

        <s-section heading="Overview">
          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <Tile label="Credit balance" value={`${data.balance} credits`} />
            <Tile label="Clicks you sent" value={data.totalSent} />
            <Tile label="Clicks you received" value={data.totalReceived} />
            <Tile label="Page views with partner ads" value={data.totalViews} />
            <Tile label="Click rate on your page" value={data.clickRate} />
            <Tile label="Your ads shown on other stores" value={data.shownOnOthers} />
          </s-grid>
          <s-text>
            Waiting in the 24-hour hold: +{data.pendingEarned} earned, -
            {data.pendingSpent} to be spent.
          </s-text>
        </s-section>

        <s-section heading="Your own products">
          <s-stack direction="block" gap="base">
            <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
              <Tile label="Product views" value={data.ownViews} />
              <Tile label="Product clicks" value={data.ownClicks} />
              <Tile label="Click rate" value={data.ownClickRate} />
            </s-grid>
            <BarChart
              values={data.ownViewsSeries}
              labels={data.labels}
              title="Own product views per day"
            />
            {data.ownProducts.length === 0 ? (
              <s-text>
                No views yet. They appear once customers see your products on
                the Thank You and Order Confirmation pages.
              </s-text>
            ) : (
              data.ownProducts.map((product) => (
                <s-text key={product.title}>
                  {product.title}: {product.views} views, {product.clicks}{" "}
                  clicks ({product.rate})
                </s-text>
              ))
            )}
          </s-stack>
        </s-section>

        <s-section heading="A/B tests">
          <s-stack direction="block" gap="base">
            {data.abTests.length === 0 ? (
              <s-text>
                No A/B tests yet. On the Slots page, click "Test a second
                product" on any slot to compare two products.
              </s-text>
            ) : (
              data.abTests.map((test) => (
                <s-box
                  key={test.slotId}
                  border="base"
                  borderRadius="base"
                  padding="base"
                >
                  <s-stack direction="block" gap="small">
                    <s-heading>
                      {test.page} {test.running ? "(running)" : "(ended)"}
                    </s-heading>
                    <s-text>
                      A: {test.aTitle} - {test.aViews} views, {test.aClicks}{" "}
                      clicks ({test.aRate})
                    </s-text>
                    <s-text>
                      B: {test.bTitle} - {test.bViews} views, {test.bClicks}{" "}
                      clicks ({test.bRate})
                    </s-text>
                    <s-text type="strong">{test.verdict}</s-text>
                  </s-stack>
                </s-box>
              ))
            )}
          </s-stack>
        </s-section>

        <s-section heading={`Today's limits (${data.planName} plan)`}>
          <s-stack direction="block" gap="small">
            <s-text>
              Page views with partner ads: {data.viewsToday} of {data.viewCap}
            </s-text>
            <s-text>
              Clicks sent: {data.clicksToday} of {data.clickCap}
            </s-text>
            <s-text>
              When either limit is reached, your Thank You page shows your own
              products until the counters reset at midnight UTC.
            </s-text>
          </s-stack>
        </s-section>

        <s-section heading="Page views with partner ads, per day">
          <BarChart
            values={data.viewsSeries}
            labels={data.labels}
            title="Page views per day"
          />
        </s-section>

        <s-section heading="Clicks you sent, per day">
          <BarChart
            values={data.sentSeries}
            labels={data.labels}
            title="Clicks sent per day"
          />
        </s-section>

        <s-section heading="Clicks you received, per day">
          <BarChart
            values={data.receivedSeries}
            labels={data.labels}
            title="Clicks received per day"
          />
        </s-section>

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