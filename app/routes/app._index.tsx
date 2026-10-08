import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

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
  const { admin } = await authenticate.admin(request);
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
  return { offers, enabled };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();

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

  const shopResponse = await admin.graphql(
    `#graphql
    query ShopId {
      shop {
        id
      }
    }`,
  );
  const shopJson = await shopResponse.json();
  const shopId = shopJson.data.shop.id;

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
    {
      variables: {
        metafields: [
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
        ],
      },
    },
  );
  const json = await response.json();
  const errors = json.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length > 0) {
    return { ok: false, message: errors[0].message as string };
  }
  return { ok: true, message: "Settings saved" };
};

const valueOf = (event: Event) =>
  (event.currentTarget as HTMLInputElement).value;

export default function Index() {
  const { offers, enabled } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const saving = fetcher.state !== "idle";

  const [drafts, setDrafts] = useState(() =>
    [0, 1, 2].map((i) => ({
      title: offers[i]?.title ?? "",
      text: offers[i]?.text ?? "",
      code: offers[i]?.code ?? "",
    })),
  );

  const update = (index: number, field: string, value: string) => {
    setDrafts((previous) =>
      previous.map((draft, i) =>
        i === index ? { ...draft, [field]: value } : draft,
      ),
    );
  };

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show("Settings saved");
    }
  }, [fetcher.data, shopify]);

  const previewOffers = drafts.filter((draft) => draft.title.trim() !== "");

  return (
    <s-page heading="Your Thank you page offers">
      <fetcher.Form method="post">
        <s-stack gap="large">
          <s-section heading="Main switch">
            <s-switch
              label="Show my offers on the Thank you page"
              name="enabled"
              defaultChecked={enabled}
            />
            <s-text>
              When this is off, nothing shows on your Thank you page.
            </s-text>
          </s-section>

          <s-section heading="Live preview">
            <s-stack gap="base">
              {previewOffers.length === 0 ? (
                <s-text>
                  Type a title in Offer 1 below and your preview shows up here.
                </s-text>
              ) : (
                previewOffers.map((draft, index) => (
                  <s-banner key={index} heading={draft.title}>
                    <s-stack gap="base">
                      {draft.text ? <s-text>{draft.text}</s-text> : null}
                      {draft.code ? (
                        <s-text type="emphasis">Code: {draft.code}</s-text>
                      ) : null}
                    </s-stack>
                  </s-banner>
                ))
              )}
            </s-stack>
          </s-section>

          <s-section heading="Offers (up to 3)">
            <s-stack gap="large">
              {[0, 1, 2].map((i) => (
                <s-stack key={i} gap="small">
                  <s-heading>Offer {i + 1}</s-heading>
                  <s-text-field
                    label="Title"
                    name={`title${i + 1}`}
                    defaultValue={offers[i]?.title ?? ""}
                    onInput={(event: Event) =>
                      update(i, "title", valueOf(event))
                    }
                  />
                  <s-text-field
                    label="Message"
                    name={`text${i + 1}`}
                    defaultValue={offers[i]?.text ?? ""}
                    onInput={(event: Event) =>
                      update(i, "text", valueOf(event))
                    }
                  />
                  <s-text-field
                    label="Discount code (optional)"
                    name={`code${i + 1}`}
                    defaultValue={offers[i]?.code ?? ""}
                    onInput={(event: Event) =>
                      update(i, "code", valueOf(event))
                    }
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
    </s-page>
  );
}