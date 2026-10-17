import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  MINIMUM_ORDERS,
  meetsMinimum,
  refreshOrderCount,
} from "../orders.server";
import { ALL_CATEGORIES } from "../categories";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });
  const ads = await prisma.ad.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "asc" },
  });
  const balance = await prisma.creditLedger.aggregate({
    where: { shopId: shop.id },
    _sum: { delta: true },
  });

  // Re-check the order count at most once an hour
  let orders = shop.ordersLast30;
  const stale =
    !shop.ordersCheckedAt ||
    Date.now() - shop.ordersCheckedAt.getTime() > 60 * 60 * 1000;
  if (stale) {
    try {
      orders = await refreshOrderCount(admin, session.shop);
    } catch (error) {
      console.error(error);
    }
  }

  return {
    swapEnabled: shop.swapEnabled,
    consent: shop.consentAt !== null,
    niche: shop.niche ?? "",
    balance: balance._sum.delta ?? 0,
    orders,
    minimum: MINIMUM_ORDERS,
    eligible: meetsMinimum(orders),
    ads: ads.map((ad) => ({
      id: ad.id,
      title: ad.title,
      imageUrl: ad.imageUrl,
      priceText: ad.priceText,
      isProduct: ad.productGid !== null,
      active: ad.active,
      disabled: ad.disabled,
      disabledReason: ad.disabledReason,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();

  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });

  // Turns off an old hand-written text ad (history is kept)
  if (form.get("intent") === "turnOffAd") {
    const adId = String(form.get("adId") || "");
    await prisma.ad.updateMany({
      where: { id: adId, shopId: shop.id },
      data: { active: false },
    });
    return { ok: true, error: "", message: "Ad turned off" };
  }

  const wantsSwap = form.get("swapEnabled") !== null;
  const consent = form.get("consent") !== null;
  const nicheRaw = String(form.get("niche") ?? "").trim();
  const niche = ALL_CATEGORIES.includes(nicheRaw) ? nicheRaw : null;

  if (wantsSwap && !consent) {
    return {
      ok: false,
      error: "Please tick the consent box before turning swap on.",
      message: "",
    };
  }

  if (wantsSwap && !niche) {
    return {
      ok: false,
      error: "Please choose your store's category before turning swap on.",
      message: "",
    };
  }

  if (wantsSwap) {
    let orders = 0;
    try {
      orders = await refreshOrderCount(admin, session.shop);
    } catch (error) {
      console.error(error);
      return {
        ok: false,
        error: "We could not check your order count. Please try again.",
        message: "",
      };
    }
    if (!meetsMinimum(orders)) {
      return {
        ok: false,
        error: `Swap needs ${MINIMUM_ORDERS} paid orders in the last 30 days. Your store has ${orders}.`,
        message: "",
      };
    }
  }

  await prisma.shop.update({
    where: { id: shop.id },
    data: {
      swapEnabled: consent && wantsSwap,
      consentAt: consent ? (shop.consentAt ?? new Date()) : null,
      niche,
    },
  });
  return { ok: true, error: "", message: "Swap settings saved" };
};

const valueOf = (event: any) => String(event.currentTarget?.value ?? "");

export default function SwapPage() {
  const saved = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const adFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [swapEnabled, setSwapEnabled] = useState(saved.swapEnabled);
  const [consent, setConsent] = useState(saved.consent);
  const [niche, setNiche] = useState(saved.niche);

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show(fetcher.data.message);
  }, [fetcher.data, shopify]);
  useEffect(() => {
    if (adFetcher.data?.ok) shopify.toast.show(adFetcher.data.message);
  }, [adFetcher.data, shopify]);

  const checkedOf = (event: any) => Boolean(event.currentTarget?.checked);

  return (
    <s-page heading="Swap ads">
      <s-stack direction="block" gap="base">
        <fetcher.Form method="post">
          <s-stack direction="block" gap="base">
            <s-section heading="Swap">
              <s-stack direction="block" gap="base">
                <s-text type="strong">
                  Your credit balance: {saved.balance}
                </s-text>
                <s-banner tone={saved.eligible ? "success" : "warning"}>
                  {saved.eligible
                    ? `Your store has ${saved.orders} paid orders in the last 30 days. Swap is available.`
                    : `Swap needs ${saved.minimum} paid orders in the last 30 days. Your store has ${saved.orders}. You can still use your own products.`}
                </s-banner>
                <s-text>
                  You earn 1 credit when a shopper clicks another store's
                  product on your Thank you page. You spend 1 credit when a
                  shopper clicks your product on another store's page. Every
                  store starts at zero credits, so your ads start showing once
                  you have earned your first credit.
                </s-text>
                <s-text>
                  When swap is on, other stores can show your products on their
                  Thank you page, and your Thank you page can show products
                  from other stores. If swap is off, your Thank you page only
                  shows your own products.
                </s-text>
                <s-select
                  label="Your store's category (required)"
                  name="niche"
                  value={niche}
                  onChange={(event: any) => setNiche(valueOf(event))}
                >
                  <s-option value="">Choose a category</s-option>
                  {ALL_CATEGORIES.map((category) => (
                    <s-option key={category} value={category}>
                      {category}
                    </s-option>
                  ))}
                </s-select>
                {saved.niche === "" ? (
                  <s-banner tone="warning">
                    Without a category, your products are not shown on other
                    stores. Choose one and save.
                  </s-banner>
                ) : null}
                <s-text>
                  Stores that sell adult (18+), alcohol, tobacco, weapons or
                  gambling products must choose the matching category. Choosing
                  a different one to avoid the filter breaks the PostSwap rules,
                  and the store can be removed.
                </s-text>
                <s-switch
                  label="Turn swap on"
                  name="swapEnabled"
                  checked={swapEnabled}
                  onChange={(event: any) => setSwapEnabled(checkedOf(event))}
                />
                <s-checkbox
                  label="I agree that products from other stores, marked Sponsored, may be shown on my Thank you page, and that my products may be shown on theirs."
                  name="consent"
                  checked={consent}
                  onChange={(event: any) => setConsent(checkedOf(event))}
                />
                {fetcher.data && !fetcher.data.ok ? (
                  <s-banner tone="critical">{fetcher.data.error}</s-banner>
                ) : null}
                <s-button type="submit" variant="primary">
                  Save swap settings
                </s-button>
              </s-stack>
            </s-section>
          </s-stack>
        </fetcher.Form>

        <s-section heading="Your ads on other stores">
          <s-stack direction="block" gap="base">
            <s-text>
              These are the products other stores can show. They come from the
              products in your Thank You slots. To change them, go to the Slots
              page.
            </s-text>
            <s-link href="/app/slots">Go to Slots</s-link>
            {saved.ads.length === 0 ? (
              <s-text>
                No ads yet. Click "Set up for me" on the Home page, or choose
                products on the Slots page.
              </s-text>
            ) : (
              saved.ads.map((ad) => (
                <s-box
                  key={ad.id}
                  border="base"
                  borderRadius="base"
                  padding="base"
                >
                  <s-stack direction="inline" gap="base">
                    {ad.imageUrl ? (
                      <s-thumbnail
                        src={ad.imageUrl}
                        alt={ad.title}
                        size="small"
                      />
                    ) : null}
                    <s-stack direction="block" gap="small">
                      <s-text type="strong">{ad.title}</s-text>
                      {ad.priceText ? <s-text>{ad.priceText}</s-text> : null}
                      <s-text>
                        {ad.disabled
                          ? `Switched off by PostSwap${ad.disabledReason ? `: ${ad.disabledReason}` : ""}`
                          : ad.active
                            ? "Live"
                            : "Off"}
                      </s-text>
                      {!ad.isProduct && ad.active ? (
                        <adFetcher.Form method="post">
                          <input type="hidden" name="intent" value="turnOffAd" />
                          <input type="hidden" name="adId" value={ad.id} />
                          <s-button type="submit" variant="tertiary">
                            Turn off this old text ad
                          </s-button>
                        </adFetcher.Form>
                      ) : null}
                    </s-stack>
                  </s-stack>
                </s-box>
              ))
            )}
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}