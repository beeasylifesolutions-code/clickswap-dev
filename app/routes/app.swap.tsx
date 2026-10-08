import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const clean = (value: FormDataEntryValue | null, max: number) =>
  String(value ?? "").trim().slice(0, max);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });
  const ad = await prisma.ad.findFirst({ where: { shopId: shop.id } });
  return {
    title: ad?.title ?? "",
    text: ad?.text ?? "",
    destination: ad?.destination ?? "",
    code: ad?.code ?? "",
    swapEnabled: shop.swapEnabled,
    consent: shop.consentAt !== null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
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