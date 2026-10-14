import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const MAX_PINS = 3;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const me = await prisma.shop.findUnique({ where: { domain: session.shop } });
  if (!me) return { partners: [], pinCount: 0, maxPins: MAX_PINS };

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const clicks = await prisma.click.findMany({
    where: { senderShopId: me.id, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { ad: true, advertiser: true },
  });
  const blocked = await prisma.blockedStore.findMany({
    where: { shopId: me.id },
  });
  const pinned = await prisma.pinnedStore.findMany({
    where: { shopId: me.id },
  });
  const blockedSet = new Set(blocked.map((row) => row.domain));
  const pinnedSet = new Set(pinned.map((row) => row.domain));

  type Entry = {
    domain: string;
    shows: number;
    ads: {
      id: string;
      title: string;
      imageUrl: string | null;
      priceText: string | null;
    }[];
  };
  const byDomain = new Map<string, Entry>();
  for (const click of clicks) {
    const domain = click.advertiser.domain;
    let entry = byDomain.get(domain);
    if (!entry) {
      entry = { domain, shows: 0, ads: [] };
      byDomain.set(domain, entry);
    }
    entry.shows += 1;
    if (entry.ads.length < 3 && !entry.ads.some((ad) => ad.id === click.ad.id)) {
      entry.ads.push({
        id: click.ad.id,
        title: click.ad.title,
        imageUrl: click.ad.imageUrl,
        priceText: click.ad.priceText,
      });
    }
  }
  // Blocked or pinned stores that have not appeared recently still show up
  for (const domain of [...blockedSet, ...pinnedSet]) {
    if (!byDomain.has(domain)) byDomain.set(domain, { domain, shows: 0, ads: [] });
  }

  const partners = Array.from(byDomain.values())
    .map((entry) => ({
      ...entry,
      blocked: blockedSet.has(entry.domain),
      pinned: pinnedSet.has(entry.domain),
    }))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.shows - a.shows;
    });

  return { partners, pinCount: pinned.length, maxPins: MAX_PINS };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const me = await prisma.shop.findUnique({ where: { domain: session.shop } });
  if (!me) return { error: "Store not found." };

  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const domain = String(form.get("domain") || "").trim().toLowerCase();
  if (!domain || domain.length > 255 || domain === me.domain) {
    return { error: "Invalid store." };
  }

  if (intent === "block") {
    await prisma.blockedStore.upsert({
      where: { shopId_domain: { shopId: me.id, domain } },
      update: {},
      create: { shopId: me.id, domain },
    });
    await prisma.pinnedStore.deleteMany({ where: { shopId: me.id, domain } });
  } else if (intent === "unblock") {
    await prisma.blockedStore.deleteMany({ where: { shopId: me.id, domain } });
  } else if (intent === "pin") {
    const blocked = await prisma.blockedStore.findFirst({
      where: { shopId: me.id, domain },
    });
    if (blocked) return { error: "Unblock this store before pinning it." };
    const count = await prisma.pinnedStore.count({ where: { shopId: me.id } });
    const already = await prisma.pinnedStore.findFirst({
      where: { shopId: me.id, domain },
    });
    if (!already && count >= MAX_PINS) {
      return { error: `You can pin up to ${MAX_PINS} stores.` };
    }
    await prisma.pinnedStore.upsert({
      where: { shopId_domain: { shopId: me.id, domain } },
      update: {},
      create: { shopId: me.id, domain },
    });
  } else if (intent === "unpin") {
    await prisma.pinnedStore.deleteMany({ where: { shopId: me.id, domain } });
  }
  return { error: "" };
};

export default function Partners() {
  const { partners, pinCount, maxPins } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const act = (intent: string, domain: string) =>
    fetcher.submit({ intent, domain }, { method: "post" });
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : "";

  return (
    <s-page heading="Partner stores">
      <s-stack gap="base">
        {error ? <s-banner tone="critical">{error}</s-banner> : null}
        <s-section heading="Stores that showed up on your Thank You page">
          <s-paragraph>
            These are the stores whose products appeared on your Thank You page
            in the last 30 days. Block a store to never see it again. Pin a
            store to see it first when it has products available ({pinCount} of{" "}
            {maxPins} pins used).
          </s-paragraph>
        </s-section>

        {partners.length === 0 ? (
          <s-banner tone="info">
            No partner stores have appeared yet. They will show up here once
            partner products start appearing on your Thank You page.
          </s-banner>
        ) : null}

        {partners.map((partner) => (
          <s-section key={partner.domain}>
            <s-stack gap="base">
              <s-stack direction="inline" gap="base">
                <s-text type="strong">{partner.domain}</s-text>
                {partner.pinned ? <s-badge tone="success">Pinned</s-badge> : null}
                {partner.blocked ? (
                  <s-badge tone="critical">Blocked</s-badge>
                ) : null}
                <s-text>Shown {partner.shows} times</s-text>
              </s-stack>

              {partner.ads.length > 0 ? (
                <s-stack direction="inline" gap="base">
                  {partner.ads.map((ad) => (
                    <s-stack key={ad.id} gap="small">
                      {ad.imageUrl ? (
                        <s-thumbnail src={ad.imageUrl} alt={ad.title} size="large" />
                      ) : null}
                      <s-text>{ad.title}</s-text>
                      {ad.priceText ? <s-text>{ad.priceText}</s-text> : null}
                    </s-stack>
                  ))}
                </s-stack>
              ) : null}

              <s-stack direction="inline" gap="base">
                {partner.blocked ? (
                  <s-button
                    disabled={busy}
                    onClick={() => act("unblock", partner.domain)}
                  >
                    Unblock
                  </s-button>
                ) : (
                  <>
                    {partner.pinned ? (
                      <s-button
                        disabled={busy}
                        onClick={() => act("unpin", partner.domain)}
                      >
                        Unpin
                      </s-button>
                    ) : (
                      <s-button
                        disabled={busy}
                        onClick={() => act("pin", partner.domain)}
                      >
                        Pin partner
                      </s-button>
                    )}
                    <s-button
                      tone="critical"
                      disabled={busy}
                      onClick={() => act("block", partner.domain)}
                    >
                      Block brand
                    </s-button>
                  </>
                )}
              </s-stack>
            </s-stack>
          </s-section>
        ))}
      </s-stack>
    </s-page>
  );
}