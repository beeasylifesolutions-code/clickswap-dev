import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { setupSlots } from "../products.server";

// Backup text offers: shown on the Thank You page only when the server has
// nothing else to show.
const MAX_OFFERS = 3;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type Offer = {
  title: string;
  text: string;
  code: string;
  start: string;
  end: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });

  const response = await admin.graphql(
    `#graphql
    query ReadSettings {
      shop {
        id
        offers: metafield(namespace: "$app", key: "offers") {
          value
        }
        enabled: metafield(namespace: "$app", key: "enabled") {
          value
        }
      }
    }`,
  );
  const json = await response.json();
  let offers: Offer[] = [];
  try {
    const raw = json.data?.shop?.offers?.value;
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) offers = parsed.slice(0, MAX_OFFERS);
  } catch (error) {
    offers = [];
  }
  const enabled = json.data?.shop?.enabled?.value !== "false";

  const [slotCount, viewCount, pausedAds] = await Promise.all([
    prisma.slot.count({ where: { shopId: shop.id, active: true } }),
    prisma.click.count({
      where: { senderShopId: shop.id, viewId: { not: null } },
    }),
    // Live ads that PostSwap has switched off (reports or an unavailable product)
    prisma.ad.findMany({
      where: { shopId: shop.id, disabled: true, active: true },
      select: { id: true, title: true, disabledReason: true },
      take: 10,
    }),
  ]);

  return {
    offers,
    enabled,
    slotsDone: slotCount > 0,
    blocksSeen: viewCount > 0,
    swapDone: shop.swapEnabled && shop.consentAt !== null,
    pausedAds,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();

  // Keeps the database kill switch in step with the main switch.
  const syncKillSwitch = async (on: boolean) => {
    try {
      await prisma.shop.upsert({
        where: { domain: session.shop },
        update: { killSwitch: !on },
        create: { domain: session.shop, killSwitch: !on },
      });
    } catch (error) {
      console.error("Could not sync kill switch", error);
    }
  };

  const shopResponse = await admin.graphql(
    `#graphql
    query ShopId {
      shop {
        id
        offers: metafield(namespace: "$app", key: "offers") {
          value
        }
      }
    }`,
  );
  const shopJson = await shopResponse.json();
  const shopId = shopJson.data.shop.id;

  const saveMetafields = async (
    metafields: Array<{
      ownerId: string;
      namespace: string;
      key: string;
      type: string;
      value: string;
    }>,
  ) => {
    const response = await admin.graphql(
      `#graphql
      mutation SaveSettings($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
      { variables: { metafields } },
    );
    const json = await response.json();
    const errors = json.data?.metafieldsSet?.userErrors ?? [];
    return errors.length > 0 ? (errors[0].message as string) : null;
  };

  // One-button setup: turns the app on, fills the 6 slots from the best
  // sellers, and adds a starter backup offer only if there are none.
  // Never overwrites the merchant's work.
  if (form.get("intent") === "setup") {
    let existing: unknown[] = [];
    try {
      const raw = shopJson.data?.shop?.offers?.value;
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) existing = parsed;
    } catch (error) {
      existing = [];
    }
    const metafields = [
      {
        ownerId: shopId,
        namespace: "$app",
        key: "enabled",
        type: "single_line_text_field",
        value: "true",
      },
    ];
    if (existing.length === 0) {
      metafields.push({
        ownerId: shopId,
        namespace: "$app",
        key: "offers",
        type: "json",
        value: JSON.stringify([
          {
            title: "Thanks for your order!",
            text: "We really appreciate you. Come back and see us again soon.",
            code: "",
            start: "",
            end: "",
          },
        ]),
      });
    }
    const problem = await saveMetafields(metafields);
    if (problem) return { ok: false, message: problem };
    await syncKillSwitch(true);
    const slotResult = await setupSlots(admin, session.shop, shopId);
    if (!slotResult.ok) return { ok: false, message: slotResult.message };
    return { ok: true, message: "Setup done" };
  }

  const enabled = form.get("enabled") !== null;

  const offers: Offer[] = [];
  for (let i = 1; i <= MAX_OFFERS; i++) {
    const title = String(form.get(`title${i}`) || "").trim().slice(0, 60);
    const text = String(form.get(`text${i}`) || "").trim().slice(0, 140);
    const code = String(form.get(`code${i}`) || "").trim().slice(0, 30);
    const startRaw = String(form.get(`start${i}`) || "").trim();
    const endRaw = String(form.get(`end${i}`) || "").trim();
    const start = DATE_PATTERN.test(startRaw) ? startRaw : "";
    const end = DATE_PATTERN.test(endRaw) ? endRaw : "";
    if (start && end && end < start) {
      return {
        ok: false,
        message: `Offer ${i}: the end date must be after the start date.`,
      };
    }
    if (title) offers.push({ title, text, code, start, end });
  }

  const problem = await saveMetafields([
    {
      ownerId: shopId,
      namespace: "$app",
      key: "offers",
      type: "json",
      value: JSON.stringify(offers),
    },
    {
      ownerId: shopId,
      namespace: "$app",
      key: "enabled",
      type: "single_line_text_field",
      value: enabled ? "true" : "false",
    },
  ]);
  if (problem) return { ok: false, message: problem };
  await syncKillSwitch(enabled);
  return { ok: true, message: "Settings saved" };
};

export default function Index() {
  const { offers, enabled, slotsDone, blocksSeen, swapDone, pausedAds } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const setupFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const saving = fetcher.state !== "idle";
  const settingUp = setupFetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show("Settings saved");
  }, [fetcher.data, shopify]);

  useEffect(() => {
    if (setupFetcher.data?.ok) {
      shopify.toast.show("Your slots are filled. Two steps left below.");
    }
  }, [setupFetcher.data, shopify]);

  const formKey = JSON.stringify([offers, enabled]);

  const Status = ({ done }: { done: boolean }) => (
    <s-badge tone={done ? "success" : "warning"}>
      {done ? "Done" : "To do"}
    </s-badge>
  );

  return (
    <s-page heading="Welcome to PostSwap">
      <s-stack gap="large">
        {pausedAds.length > 0 ? (
          <s-banner tone="warning" heading="Some of your ads are switched off">
            <s-stack gap="small">
              {pausedAds.map((ad) => (
                <s-text key={ad.id}>
                  {ad.title}:{" "}
                  {ad.disabledReason || "switched off by PostSwap"}
                </s-text>
              ))}
              <s-link href="/app/swap">See your ads</s-link>
            </s-stack>
          </s-banner>
        ) : null}

        <s-section heading="Get set up in 3 steps">
          <s-stack gap="base">
            <s-box border="base" borderRadius="base" padding="base">
              <s-stack gap="small">
                <s-stack direction="inline" gap="base">
                  <s-heading>1. Fill your slots</s-heading>
                  <Status done={slotsDone} />
                </s-stack>
                <s-text>
                  One click picks your top 3 products and fills your 6 slots (3
                  on the Order Confirmation page, 3 on the Thank You page). It
                  never changes slots you already filled in.
                </s-text>
                <setupFetcher.Form method="post">
                  <input type="hidden" name="intent" value="setup" />
                  <s-button
                    type="submit"
                    variant="primary"
                    loading={settingUp}
                  >
                    Set up for me
                  </s-button>
                </setupFetcher.Form>
                {setupFetcher.data && !setupFetcher.data.ok ? (
                  <s-banner tone="critical">
                    {setupFetcher.data.message}
                  </s-banner>
                ) : null}
                <s-link href="/app/slots">Choose your own products</s-link>
              </s-stack>
            </s-box>

            <s-box border="base" borderRadius="base" padding="base">
              <s-stack gap="small">
                <s-stack direction="inline" gap="base">
                  <s-heading>2. Add the two blocks</s-heading>
                  <Status done={blocksSeen} />
                </s-stack>
                <s-text>
                  Shopify only lets you place these yourself. In Settings, then
                  Checkout, then Customize: open the Thank you page and add the
                  "thank-you-offers" block, then open the Order status page and
                  add the "order-status-offers" block. Save each page.
                </s-text>
                <s-link
                  href="shopify:admin/settings/checkout/editor"
                  target="_blank"
                >
                  Open the checkout editor
                </s-link>
              </s-stack>
            </s-box>

            <s-box border="base" borderRadius="base" padding="base">
              <s-stack gap="small">
                <s-stack direction="inline" gap="base">
                  <s-heading>3. Turn on the swap (optional)</s-heading>
                  <Status done={swapDone} />
                </s-stack>
                <s-text>
                  Swap shows other stores' products on your Thank You page, and
                  yours on theirs. It needs your agreement, and your store needs
                  at least 50 paid orders in the last 30 days. Without it, your
                  own products still fill every slot.
                </s-text>
                <s-link href="/app/swap">Go to Swap ads</s-link>
              </s-stack>
            </s-box>
          </s-stack>
        </s-section>

        <fetcher.Form method="post" key={formKey}>
          <s-stack gap="large">
            <s-section heading="Main switch">
              <s-switch
                label="Show PostSwap on my Thank you page"
                name="enabled"
                defaultChecked={enabled}
              />
              <s-text>
                When this is off, nothing from PostSwap shows on your Thank you
                page, and your store is not part of the swap.
              </s-text>
            </s-section>

            <s-section heading={`Backup text offers (up to ${MAX_OFFERS})`}>
              <s-stack gap="large">
                <s-text>
                  These show on your Thank you page only if PostSwap has no
                  products to show there. Most stores can leave this alone.
                </s-text>
                {[0, 1, 2].map((i) => (
                  <s-stack key={i} gap="small">
                    <s-heading>Offer {i + 1}</s-heading>
                    <s-text-field
                      label="Title"
                      name={`title${i + 1}`}
                      defaultValue={offers[i]?.title ?? ""}
                    />
                    <s-text-field
                      label="Message"
                      name={`text${i + 1}`}
                      defaultValue={offers[i]?.text ?? ""}
                    />
                    <s-text-field
                      label="Discount code (optional)"
                      name={`code${i + 1}`}
                      defaultValue={offers[i]?.code ?? ""}
                    />
                    <s-date-field
                      label="Start date (optional)"
                      name={`start${i + 1}`}
                      defaultValue={offers[i]?.start ?? ""}
                    />
                    <s-date-field
                      label="End date (optional)"
                      name={`end${i + 1}`}
                      defaultValue={offers[i]?.end ?? ""}
                    />
                  </s-stack>
                ))}
              </s-stack>
            </s-section>

            {fetcher.data && !fetcher.data.ok ? (
              <s-banner tone="critical">{fetcher.data.message}</s-banner>
            ) : null}
            <s-button type="submit" variant="primary" loading={saving}>
              Save settings
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-stack>
    </s-page>
  );
}