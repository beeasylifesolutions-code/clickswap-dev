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

const clean = (value: FormDataEntryValue | null, max: number) =>
  String(value ?? "").trim().slice(0, max);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });
  const ad = await prisma.ad.findFirst({ where: { shopId: shop.id } });
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
    title: ad?.title ?? "",
    text: ad?.text ?? "",
    destination: ad?.destination ?? "",
    code: ad?.code ?? "",
    swapEnabled: shop.swapEnabled,
    consent: shop.consentAt !== null,
    balance: balance._sum.delta ?? 0,
    orders,
    minimum: MINIMUM_ORDERS,
    eligible: meetsMinimum(orders),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();

  const title = clean(form.get("title"), 60);
  const text = clean(form.get("text"), 140);
  const destination = clean(form.get("destination"), 300);
  const code = clean(form.get("code"), 30);
  const wantsSwap = form.get("swapEnabled") !== null;
  const consent = form.get("consent") !== null;

  if (!title || !text || !destination) {
    return { ok: false, error: "Please fill in the title, message and link." };
  }
  let url: URL;
  try {
    url = new URL(destination);
  } catch (error) {
    return { ok: false, error: "The link must be a full web address." };
  }
  if (url.protocol !== "https:") {
    return { ok: false, error: "The link must start with https://" };
  }
  if (wantsSwap && !consent) {
    return {
      ok: false,
      error: "Please tick the consent box before turning swap on.",
    };
  }

  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });

  if (wantsSwap) {
    let orders = 0;
    try {
      orders = await refreshOrderCount(admin, session.shop);
    } catch (error) {
      console.error(error);
      return {
        ok: false,
        error: "We could not check your order count. Please try again.",
      };
    }
    if (!meetsMinimum(orders)) {
      return {
        ok: false,
        error: `Swap needs ${MINIMUM_ORDERS} paid orders in the last 30 days. Your store has ${orders}.`,
      };
    }
  }

  await prisma.shop.update({
    where: { id: shop.id },
    data: {
      swapEnabled: consent && wantsSwap,
      consentAt: consent ? (shop.consentAt ?? new Date()) : null,
    },
  });

  const existing = await prisma.ad.findFirst({ where: { shopId: shop.id } });
  const data = { title, text, destination, code: code || null };
  if (existing) {
    await prisma.ad.update({ where: { id: existing.id }, data });
  } else {
    await prisma.ad.create({ data: { ...data, shopId: shop.id } });
  }
  return { ok: true, error: "" };
};

export default function SwapPage() {
  const saved = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [title, setTitle] = useState(saved.title);
  const [text, setText] = useState(saved.text);
  const [destination, setDestination] = useState(saved.destination);
  const [code, setCode] = useState(saved.code);
  const [swapEnabled, setSwapEnabled] = useState(saved.swapEnabled);
  const [consent, setConsent] = useState(saved.consent);

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show("Swap settings saved");
  }, [fetcher.data, shopify]);

  const valueOf = (event: any) => String(event.currentTarget?.value ?? "");
  const checkedOf = (event: any) => Boolean(event.currentTarget?.checked);

  return (
    <s-page heading="Swap ads">
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
                  : `Swap needs ${saved.minimum} paid orders in the last 30 days. Your store has ${saved.orders}. You can still use your own offers.`}
              </s-banner>
              <s-text>
                You earn 1 credit when a shopper clicks another store's ad on
                your Thank you page. You spend 1 credit when a shopper clicks
                your ad on another store's page. Every store starts at zero
                credits, so your ad starts showing once you have earned your
                first credit.
              </s-text>
              <s-text>
                When swap is on, other stores show your ad on their Thank you
                page, and your Thank you page can show ads from other stores.
                If swap is off, your Thank you page only shows your own offers.
              </s-text>
              <s-switch
                label="Turn swap on"
                name="swapEnabled"
                checked={swapEnabled}
                onChange={(event: any) => setSwapEnabled(checkedOf(event))}
              />
              <s-checkbox
                label="I agree that ads from other stores, marked Sponsored, may be shown on my Thank you page, and that my ad may be shown on theirs."
                name="consent"
                checked={consent}
                onChange={(event: any) => setConsent(checkedOf(event))}
              />
            </s-stack>
          </s-section>

          <s-section heading="Your swap ad">
            <s-stack direction="block" gap="base">
              <s-text>
                This is the ad other stores will show on their Thank you page.
              </s-text>
              <s-text-field
                label="Title"
                name="title"
                value={title}
                onInput={(event: any) => setTitle(valueOf(event))}
              />
              <s-text-field
                label="Message"
                name="text"
                value={text}
                onInput={(event: any) => setText(valueOf(event))}
              />
              <s-text-field
                label="Link (where the click goes)"
                name="destination"
                value={destination}
                onInput={(event: any) => setDestination(valueOf(event))}
              />
              <s-text-field
                label="Discount code (optional)"
                name="code"
                value={code}
                onInput={(event: any) => setCode(valueOf(event))}
              />
            </s-stack>
          </s-section>

          {fetcher.data && !fetcher.data.ok ? (
            <s-banner tone="critical">{fetcher.data.error}</s-banner>
          ) : null}
          <s-button type="submit">Save swap settings</s-button>
        </s-stack>
      </fetcher.Form>
    </s-page>
  );
}