import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

const MAX_OFFERS = 3;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(
    `#graphql
    query ReadOffers {
      shop {
        id
        metafield(namespace: "$app", key: "offers") {
          value
        }
      }
    }`,
  );
  const json = await response.json();
  let offers: { title: string; text: string; code: string }[] = [];
  try {
    const raw = json.data?.shop?.metafield?.value;
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) offers = parsed.slice(0, MAX_OFFERS);
  } catch (error) {
    offers = [];
  }
  return { offers };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();

  const offers: { title: string; text: string; code: string }[] = [];
  for (let i = 1; i <= MAX_OFFERS; i++) {
    const title = String(form.get(`title${i}`) || "").trim().slice(0, 60);
    const text = String(form.get(`text${i}`) || "").trim().slice(0, 140);
    const code = String(form.get(`code${i}`) || "").trim().slice(0, 30);
    if (title) offers.push({ title, text, code });
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
    mutation SaveOffers($metafields: [MetafieldsSetInput!]!) {
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
        ],
      },
    },
  );
  const json = await response.json();
  const errors = json.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length > 0) {
    return { ok: false, message: errors[0].message as string };
  }
  return { ok: true, message: "Offers saved" };
};

export default function Index() {
  const { offers } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const saving = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show("Offers saved");
    }
  }, [fetcher.data, shopify]);

  return (
    <s-page heading="Your Thank you page offers">
      <s-section heading="Offers (up to 3)">
        <fetcher.Form method="post">
          <s-stack gap="large">
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
              </s-stack>
            ))}
            {fetcher.data && !fetcher.data.ok ? (
              <s-banner tone="critical">{fetcher.data.message}</s-banner>
            ) : null}
            <s-button type="submit" variant="primary" loading={saving}>
              Save offers
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>
    </s-page>
  );
}