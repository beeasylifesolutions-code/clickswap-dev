import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { meetsMinimum } from "../orders.server";
import {
  ALL_CATEGORIES,
  NORMAL_CATEGORIES,
  RESTRICTED_CATEGORIES,
} from "../categories";

const clean = (value: FormDataEntryValue | null, max: number) =>
  String(value ?? "").trim().slice(0, max);

// Turns "https://Partner-Store.myshopify.com/" or "partner-store" into
// "partner-store.myshopify.com". Returns "" if it does not look like a store.
const normalizeDomain = (raw: string) => {
  let value = raw.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "").split("/")[0].split("?")[0];
  if (!value) return "";
  if (!value.includes(".")) value = `${value}.myshopify.com`;
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(value) ? value : "";
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
    include: { blockedStores: { orderBy: { createdAt: "desc" } } },
  });

  // The kill switch lives in the same on/off setting the Thank you page reads
  const response = await admin.graphql(
    `#graphql
    query ReadKillSwitch {
      shop {
        enabled: metafield(namespace: "$app", key: "enabled") {
          value
        }
      }
    }`,
  );
  const json = await response.json();
  const killSwitch = json.data?.shop?.enabled?.value === "false";

  return {
    killSwitch,
    swapEnabled: shop.swapEnabled,
    hasConsent: shop.consentAt !== null,
    niche: shop.niche ?? "",
    showRestricted: shop.showRestricted,
    blockedCategories: shop.blockedCategories,
    blockedStores: shop.blockedStores.map((block) => block.domain),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "save");

  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });

  if (intent === "add") {
    const domain = normalizeDomain(String(form.get("domain") || ""));
    if (!domain) {
      return {
        ok: false,
        message: "Please enter a store address like partner-store.myshopify.com.",
      };
    }
    if (domain === session.shop) {
      return { ok: false, message: "You can't block your own store." };
    }
    await prisma.blockedStore.upsert({
      where: { shopId_domain: { shopId: shop.id, domain } },
      update: {},
      create: { shopId: shop.id, domain },
    });
    return { ok: true, message: `Blocked ${domain}` };
  }

  if (intent === "remove") {
    const domain = normalizeDomain(String(form.get("domain") || ""));
    await prisma.blockedStore.deleteMany({
      where: { shopId: shop.id, domain },
    });
    return { ok: true, message: "Store unblocked" };
  }

  // intent === "save"
  const killSwitch = form.get("killSwitch") !== null;
  const wantsSwap = form.get("swapEnabled") !== null;
  const showRestricted = form.get("showRestricted") !== null;
  const nicheRaw = clean(form.get("niche"), 40);
  const niche = ALL_CATEGORIES.includes(nicheRaw) ? nicheRaw : null;
  const blockedCategories = NORMAL_CATEGORIES.filter(
    (_, index) => form.get(`cat_${index}`) !== null,
  );

  if (wantsSwap && !shop.consentAt) {
    return {
      ok: false,
      message:
        "To turn swap on, first agree to the terms on the Swap ads page.",
    };
  }
  if (wantsSwap && !niche) {
    return {
      ok: false,
      message: "Choose your store's category before turning swap on.",
    };
  }
  if (wantsSwap && !meetsMinimum(shop.ordersLast30)) {
    return {
      ok: false,
      message: "Swap needs more paid orders in the last 30 days before it can be on.",
    };
  }

  // Save the on/off setting where the Thank you page reads it
  const idResponse = await admin.graphql(
    `#graphql
    query ShopId {
      shop {
        id
      }
    }`,
  );
  const idJson = await idResponse.json();
  const shopId = idJson.data.shop.id;

  const saveResponse = await admin.graphql(
    `#graphql
    mutation SaveKillSwitch($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: shopId,
            namespace: "$app",
            key: "enabled",
            type: "single_line_text_field",
            value: killSwitch ? "false" : "true",
          },
        ],
      },
    },
  );
  const saveJson = await saveResponse.json();
  const errors = saveJson.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length > 0) {
    return { ok: false, message: errors[0].message as string };
  }

  await prisma.shop.update({
    where: { id: shop.id },
    data: {
      killSwitch,
      swapEnabled: wantsSwap && shop.consentAt !== null,
      niche,
      showRestricted,
      blockedCategories,
    },
  });

  return { ok: true, message: "Safety settings saved" };
};

const valueOf = (event: any) => String(event.currentTarget?.value ?? "");

function UnblockButton({ domain }: { domain: string }) {
  const fetcher = useFetcher<typeof action>();
  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="remove" />
      <input type="hidden" name="domain" value={domain} />
      <s-button
        type="submit"
        variant="tertiary"
        loading={fetcher.state !== "idle"}
      >
        Unblock
      </s-button>
    </fetcher.Form>
  );
}

export default function SafetyPage() {
  const saved = useLoaderData<typeof loader>();
  const settingsFetcher = useFetcher<typeof action>();
  const addFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [niche, setNiche] = useState(saved.niche);
  const [newDomain, setNewDomain] = useState("");

  useEffect(() => {
    if (settingsFetcher.data?.ok) {
      shopify.toast.show(settingsFetcher.data.message);
    }
  }, [settingsFetcher.data, shopify]);

  useEffect(() => {
    if (addFetcher.data?.ok) {
      shopify.toast.show(addFetcher.data.message);
      setNewDomain("");
    }
  }, [addFetcher.data, shopify]);

  return (
    <s-page heading="Safety">
      <s-stack direction="block" gap="large">
        <settingsFetcher.Form method="post">
          <input type="hidden" name="intent" value="save" />
          <s-stack direction="block" gap="large">
            <s-section heading="Kill switch">
              <s-stack direction="block" gap="base">
                <s-text>
                  Turns everything off at once: your own offers and all partner
                  ads disappear from your pages. Nothing is uninstalled.
                </s-text>
                <s-switch
                  label="Turn the whole app off"
                  name="killSwitch"
                  defaultChecked={saved.killSwitch}
                />
              </s-stack>
            </s-section>

            <s-section heading="Network swap">
              <s-stack direction="block" gap="base">
                <s-text>
                  Pause swaps at any time. When swap is off, your pages show
                  only your own offers.
                </s-text>
                <s-switch
                  label="Show partner ads from the network"
                  name="swapEnabled"
                  defaultChecked={saved.swapEnabled}
                />
                {!saved.hasConsent ? (
                  <s-banner tone="info">
                    To turn swap on for the first time, agree to the terms on
                    the Swap ads page.
                  </s-banner>
                ) : null}
              </s-stack>
            </s-section>

            <s-section heading="Your store's category">
              <s-stack direction="block" gap="base">
                <s-text>
                  Required to use the swap. Other stores can block whole
                  categories, so choose the one that fits your products. A store
                  with no category is never shown to anyone.
                </s-text>
                <s-select
                  label="Category"
                  name="niche"
                  value={niche}
                  onChange={(event: any) => setNiche(valueOf(event))}
                >
                  <s-option value="">Not set</s-option>
                  {ALL_CATEGORIES.map((category) => (
                    <s-option key={category} value={category}>
                      {category}
                    </s-option>
                  ))}
                </s-select>
                <s-text>
                  Stores that sell adult (18+), alcohol, tobacco, weapons or
                  gambling products must choose the matching category. Choosing
                  a different one to avoid the filter breaks the PostSwap rules,
                  and the store can be removed.
                </s-text>
              </s-stack>
            </s-section>

            <s-section heading="Adult and restricted stores">
              <s-stack direction="block" gap="base">
                <s-text>
                  Ads from stores in these categories are hidden from your
                  pages: {RESTRICTED_CATEGORIES.join(", ")}. Leave this off
                  unless your own store sells these products.
                </s-text>
                <s-switch
                  label="Also show ads from adult and restricted stores"
                  name="showRestricted"
                  defaultChecked={saved.showRestricted}
                />
              </s-stack>
            </s-section>

            <s-section heading="Blocked categories">
              <s-stack direction="block" gap="small">
                <s-text>
                  Ads from stores in the categories you tick will never show on
                  your pages.
                </s-text>
                {NORMAL_CATEGORIES.map((category, index) => (
                  <s-checkbox
                    key={category}
                    label={category}
                    name={`cat_${index}`}
                    defaultChecked={saved.blockedCategories.includes(category)}
                  />
                ))}
              </s-stack>
            </s-section>

            {settingsFetcher.data && !settingsFetcher.data.ok ? (
              <s-banner tone="critical">
                {settingsFetcher.data.message}
              </s-banner>
            ) : null}
            <s-button
              type="submit"
              variant="primary"
              loading={settingsFetcher.state !== "idle"}
            >
              Save safety settings
            </s-button>
          </s-stack>
        </settingsFetcher.Form>

        <s-section heading="Blocked stores">
          <s-stack direction="block" gap="base">
            <s-text>
              A blocked store's ads never show on your pages, and your ad never
              shows on theirs.
            </s-text>
            <addFetcher.Form method="post">
              <input type="hidden" name="intent" value="add" />
              <s-stack direction="block" gap="small">
                <s-text-field
                  label="Store address"
                  name="domain"
                  placeholder="partner-store.myshopify.com"
                  value={newDomain}
                  onInput={(event: any) => setNewDomain(valueOf(event))}
                />
                {addFetcher.data && !addFetcher.data.ok ? (
                  <s-banner tone="critical">{addFetcher.data.message}</s-banner>
                ) : null}
                <s-button
                  type="submit"
                  loading={addFetcher.state !== "idle"}
                >
                  Block this store
                </s-button>
              </s-stack>
            </addFetcher.Form>

            {saved.blockedStores.length === 0 ? (
              <s-text>You haven't blocked any stores.</s-text>
            ) : (
              <s-stack direction="block" gap="small">
                {saved.blockedStores.map((domain) => (
                  <s-stack
                    key={domain}
                    direction="inline"
                    gap="base"
                    alignItems="center"
                  >
                    <s-text>{domain}</s-text>
                    <UnblockButton domain={domain} />
                  </s-stack>
                ))}
              </s-stack>
            )}
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}