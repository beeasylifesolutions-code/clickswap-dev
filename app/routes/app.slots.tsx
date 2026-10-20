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

const MODES = ["swap_first", "self_promo", "locked_store"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
    include: { pinnedStores: { select: { domain: true } } },
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
  const pinned = shop.pinnedStores.map((pin) => pin.domain);
  return { slots, currency, domain: session.shop, pinned };
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
    include: { pinnedStores: { select: { domain: true } } },
  });
  if (!shop) return { ok: false, message: "Shop not found." };
  const pinned = shop.pinnedStores.map((pin) => pin.domain);

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
  } else if (intent === "setB") {
    // Start an A/B test: pick a second product for a slot that already has one
    const productGid = String(form.get("productGid") || "");
    const title = String(form.get("title") || "").slice(0, 80);
    const imageUrl = String(form.get("imageUrl") || "") || null;
    const priceText = String(form.get("priceText") || "") || null;
    const productUrl = String(form.get("productUrl") || "");
    if (!productGid || !title || !productUrl.startsWith("https://")) {
      return { ok: false, message: "Could not read that product." };
    }
    const existing = await prisma.slot.findUnique({ where });
    if (!existing || !existing.title) {
      return { ok: false, message: "Choose Product A for this slot first." };
    }
    if (existing.productGid === productGid) {
      return {
        ok: false,
        message: "Pick a different product for B. It matches Product A.",
      };
    }
    await prisma.slot.update({
      where: { id: existing.id },
      data: {
        abActive: true,
        abStartedAt: new Date(),
        bProductGid: productGid,
        bTitle: title,
        bImageUrl: imageUrl,
        bPriceText: priceText,
        bProductUrl: productUrl,
      },
    });
    message = "A/B test started";
  } else if (intent === "keepA" || intent === "keepB") {
    // End the test. Keep A: drop B. Keep B: B becomes the slot's product.
    const existing = await prisma.slot.findUnique({ where });
    if (!existing) return { ok: false, message: "That slot does not exist." };
    const cleared = {
      abActive: false,
      abStartedAt: null,
      bProductGid: null,
      bTitle: null,
      bImageUrl: null,
      bPriceText: null,
      bProductUrl: null,
    };
    if (intent === "keepB" && existing.bTitle && existing.bProductUrl) {
      await prisma.slot.update({
        where: { id: existing.id },
        data: {
          ...cleared,
          productGid: existing.bProductGid,
          title: existing.bTitle,
          imageUrl: existing.bImageUrl,
          priceText: existing.bPriceText,
          productUrl: existing.bProductUrl,
        },
      });
      message = "Product B is now the slot's product";
    } else {
      await prisma.slot.update({ where: { id: existing.id }, data: cleared });
      message = "Test ended, keeping Product A";
    }
  } else if (intent === "mode") {
    const mode = String(form.get("mode") || "");
    if (surface !== "thank_you" || !MODES.includes(mode)) {
      return { ok: false, message: "That setting is not available." };
    }
    const existing = await prisma.slot.findUnique({ where });
    if (!existing) return { ok: false, message: "That slot does not exist." };
    if (mode === "locked_store") {
      if (pinned.length === 0) {
        return {
          ok: false,
          message:
            "Pin a partner store on the Partners page first, then lock this slot to it.",
        };
      }
      const keep =
        existing.lockedDomain && pinned.includes(existing.lockedDomain)
          ? existing.lockedDomain
          : pinned[0];
      await prisma.slot.update({
        where: { id: existing.id },
        data: { mode, lockedDomain: keep },
      });
    } else {
      await prisma.slot.update({
        where: { id: existing.id },
        data: { mode, lockedDomain: null },
      });
    }
    message = "Mode saved";
  } else if (intent === "lockStore") {
    const domainChoice = String(form.get("lockedDomain") || "");
    if (surface !== "thank_you" || !pinned.includes(domainChoice)) {
      return { ok: false, message: "Choose one of your pinned partners." };
    }
    await prisma.slot.updateMany({
      where: { shopId: shop.id, surface, position, mode: "locked_store" },
      data: { lockedDomain: domainChoice },
    });
    message = "Locked store saved";
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
  locked_store: "Always show one chosen partner (my product as backup)",
};

export default function SlotsPage() {
  const { slots, currency, domain, pinned } = useLoaderData<typeof loader>();
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

  // intent "set" picks Product A, intent "setB" picks the A/B test's Product B
  const choose = async (
    surface: string,
    position: number,
    intent: "set" | "setB" = "set",
  ) => {
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
      intent,
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
                const testing = Boolean(
                  slot && slot.abActive && slot.bTitle && slot.bProductUrl,
                );
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
                            {testing ? <s-badge>Product A</s-badge> : null}
                            <s-text type="strong">{slot.title}</s-text>
                            {slot.priceText ? (
                              <s-text>{slot.priceText}</s-text>
                            ) : null}
                          </s-stack>
                        </s-stack>
                      ) : (
                        <s-text>Empty. Choose a product for this slot.</s-text>
                      )}

                      {testing && slot ? (
                        <s-box
                          border="base"
                          borderRadius="base"
                          padding="base"
                        >
                          <s-stack gap="small">
                            <s-heading>A/B test running</s-heading>
                            <s-text>
                              Shoppers are split 50/50 between Product A and
                              Product B. Results are on your Dashboard.
                            </s-text>
                            <s-stack direction="inline" gap="base">
                              {slot.bImageUrl ? (
                                <s-thumbnail
                                  src={slot.bImageUrl}
                                  alt={slot.bTitle ?? "Product B"}
                                  size="small"
                                />
                              ) : null}
                              <s-stack gap="small">
                                <s-badge>Product B</s-badge>
                                <s-text type="strong">{slot.bTitle}</s-text>
                                {slot.bPriceText ? (
                                  <s-text>{slot.bPriceText}</s-text>
                                ) : null}
                              </s-stack>
                            </s-stack>
                            <s-stack direction="inline" gap="base">
                              <s-button
                                disabled={busy}
                                onClick={() =>
                                  submit({
                                    intent: "keepA",
                                    surface: surface.key,
                                    position: String(position),
                                  })
                                }
                              >
                                End test, keep A
                              </s-button>
                              <s-button
                                disabled={busy}
                                onClick={() =>
                                  submit({
                                    intent: "keepB",
                                    surface: surface.key,
                                    position: String(position),
                                  })
                                }
                              >
                                End test, keep B
                              </s-button>
                            </s-stack>
                          </s-stack>
                        </s-box>
                      ) : null}

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

                      {surface.key === "thank_you" &&
                      slot &&
                      slot.mode === "locked_store" ? (
                        <s-select
                          label="Locked partner store"
                          value={slot.lockedDomain ?? ""}
                          onChange={(event: Event) =>
                            submit({
                              intent: "lockStore",
                              surface: surface.key,
                              position: String(position),
                              lockedDomain: (
                                event.currentTarget as HTMLSelectElement
                              ).value,
                            })
                          }
                        >
                          {pinned.map((pinnedDomain) => (
                            <s-option key={pinnedDomain} value={pinnedDomain}>
                              {pinnedDomain}
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
                        {slot && slot.title && !testing ? (
                          <s-button
                            disabled={busy}
                            onClick={() =>
                              choose(surface.key, position, "setB")
                            }
                          >
                            Test a second product
                          </s-button>
                        ) : null}
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