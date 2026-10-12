import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { saveSlotsMetafield, syncProductAds } from "../products.server";

const SURFACES = [
  {
    key: "order_confirmation",
    heading: "Order Confirmation page",
    note: "These 3 slots always show your own products. Partner ads never appear here.",
  },
  {
    key: "thank_you",
    heading: "Thank You page",
    note: "These 3 slots show a partner product first when one is available, and your own product otherwise. Your products here also become your ads on partner stores.",
  },
];

const MODES = ["swap_first", "self_promo"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });
  const slots = await prisma.slot.findMany({
    where: { shopId: shop.id },
    orderBy: [{ surface: "asc" }, { position: "asc" }],
  });
  let currency = "USD";
  try {
    const response = await admin.graphql(
      `#graphql
      query {
        shop {
          currencyCode
        }
      }`,
    );
    const json = await response.json();
    currency = json?.data?.shop?.currencyCode || "USD";
  } catch (error) {
    currency = "USD";
  }
  return { slots, currency, domain: session.shop };
};

// Keeps the network ads in step with the Thank You slots:
// ads for products in a slot are on, ads for products that left a slot are off.
async function syncAdsActive(shopId: string) {
  const slots = await prisma.slot.findMany({
    where: { shopId, surface: "thank_you", productGid: { not: null } },
    select: { productGid: true },
  });
  const gids = slots.map((slot) => slot.productGid as string);
  await prisma.ad.updateMany({
    where: { shopId, productGid: { not: null, notIn: gids } },
    data: { active: false },
  });
  if (gids.length > 0) {
    await prisma.ad.updateMany({
      where: { shopId, productGid: { in: gids } },
      data: { active: true },
    });
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();

  const shop = await prisma.shop.findUnique({
    where: { domain: session.shop },
  });
  if (!shop) return { ok: false, message: "Shop not found." };

  const intent = String(form.get("intent") || "");
  const surface = String(form.get("surface") || "");
  const position = Number(form.get("position"));
  if (
    !SURFACES.some((s) => s.key === surface) ||
    ![1, 2, 3].includes(position)
  ) {
    return { ok: false, message: "That slot does not exist." };
  }
  const where = {
    shopId_surface_position: { shopId: shop.id, surface, position },
  };

  let message = "Saved";

  if (intent === "set") {
    const productGid = String(form.get("productGid") || "");
    const title = String(form.get("title") || "").slice(0, 80);
    const imageUrl = String(form.get("imageUrl") || "") || null;
    const priceText = String(form.get("priceText") || "") || null;
    const productUrl = String(form.get("productUrl") || "");
    if (!productGid || !title || !productUrl.startsWith("https://")) {
      return { ok: false, message: "Could not read that product." };
    }
    const existing = await prisma.slot.findUnique({ where });
    const mode =
      existing?.mode ??
      (surface === "order_confirmation" ? "self_promo" : "swap_first");
    const data = {
      mode,
      active: true,
      productGid,
      title,
      imageUrl,
      priceText,
      productUrl,
    };
    await prisma.slot.upsert({
      where,
      update: data,
      create: { shopId: shop.id, surface, position, ...data },
    });
    message = "Product saved";
  } else if (intent === "mode") {
    const mode = String(form.get("mode") || "");
    if (surface !== "thank_you" || !MODES.includes(mode)) {
      return { ok: false, message: "That setting is not available." };
    }
    await prisma.slot.updateMany({
      where: { shopId: shop.id, surface, position },
      data: { mode },
    });
    message = "Mode saved";
  } else if (intent === "clear") {
    await prisma.slot.deleteMany({
      where: { shopId: shop.id, surface, position },
    });
    message = "Slot cleared";
  } else {
    return { ok: false, message: "Unknown action." };
  }

  if (surface === "thank_you") {
    await syncProductAds(shop.id);
    await syncAdsActive(shop.id);
  }

  const shopResponse = await admin.graphql(`#graphql
    query {
      shop {
        id
      }
    }`);
  const shopJson = await shopResponse.json();
  const shopGid = shopJson?.data?.shop?.id;
  if (shopGid) await saveSlotsMetafield(admin, shop.id, shopGid);

  return { ok: true, message };
};

const MODE_LABELS: Record<string, string> = {
  swap_first: "Partner product first, my product as backup",
  self_promo: "My product only",
};

export default function SlotsPage() {
  const { slots, currency, domain } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok) shopify.toast.show(fetcher.data.message);
    else shopify.toast.show(fetcher.data.message, { isError: true });
  }, [fetcher.data, shopify]);

  const find = (surface: string, position: number) =>
    slots.find((slot) => slot.surface === surface && slot.position === position);

  const submit = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.append(key, value);
    fetcher.submit(data, { method: "post" });
  };

  const choose = async (surface: string, position: number) => {
    const selected: any = await (shopify as any).resourcePicker({
      type: "product",
      multiple: false,
    });
    const product = selected?.[0];
    if (!product) return;
    const image = product.images?.[0];
    const rawPrice = product.variants?.[0]?.price;
    let priceText = "";
    if (rawPrice) {
      try {
        priceText = new Intl.NumberFormat("en-US", {
          style: "currency",
          currency,
        }).format(Number(rawPrice));
      } catch (error) {
        priceText = `${rawPrice} ${currency}`;
      }
    }
    submit({
      intent: "set",
      surface,
      position: String(position),
      productGid: product.id,
      title: product.title,
      imageUrl: image?.originalSrc || image?.src || "",
      priceText,
      productUrl: `https://${domain}/products/${product.handle}`,
    });
  };

  return (
    <s-page heading="Slots">
      <s-stack gap="large">
        {SURFACES.map((surface) => (
          <s-section key={surface.key} heading={surface.heading}>
            <s-stack gap="base">
              <s-text>{surface.note}</s-text>
              {[1, 2, 3].map((position) => {
                const slot = find(surface.key, position);
                return (
                  <s-box
                    key={position}
                    border="base"
                    borderRadius="base"
                    padding="base"
                  >
                    <s-stack gap="small">
                      <s-heading>Slot {position}</s-heading>
                      {slot && slot.title ? (
                        <s-stack direction="inline" gap="base">
                          {slot.imageUrl ? (
                            <s-thumbnail
                              src={slot.imageUrl}
                              alt={slot.title}
                              size="small"
                            />
                          ) : null}
                          <s-stack gap="small">
                            <s-text type="strong">{slot.title}</s-text>
                            {slot.priceText ? (
                              <s-text>{slot.priceText}</s-text>
                            ) : null}
                          </s-stack>
                        </s-stack>
                      ) : (
                        <s-text>Empty. Choose a product for this slot.</s-text>
                      )}

                      {surface.key === "thank_you" && slot ? (
                        <s-select
                          label="What this slot shows"
                          value={slot.mode}
                          onChange={(event: Event) =>
                            submit({
                              intent: "mode",
                              surface: surface.key,
                              position: String(position),
                              mode: (event.currentTarget as HTMLSelectElement)
                                .value,
                            })
                          }
                        >
                          {MODES.map((mode) => (
                            <s-option key={mode} value={mode}>
                              {MODE_LABELS[mode]}
                            </s-option>
                          ))}
                        </s-select>
                      ) : null}

                      <s-stack direction="inline" gap="base">
                        <s-button
                          disabled={busy}
                          onClick={() => choose(surface.key, position)}
                        >
                          {slot && slot.title ? "Change product" : "Choose product"}
                        </s-button>
                        {slot && slot.title ? (
                          <s-button
                            variant="tertiary"
                            tone="critical"
                            disabled={busy}
                            onClick={() =>
                              submit({
                                intent: "clear",
                                surface: surface.key,
                                position: String(position),
                              })
                            }
                          >
                            Clear
                          </s-button>
                        ) : null}
                      </s-stack>
                    </s-stack>
                  </s-box>
                );
              })}
            </s-stack>
          </s-section>
        ))}
      </s-stack>
    </s-page>
  );
}