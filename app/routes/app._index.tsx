import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Every plan has the same number of slots and own offers
const MAX_OFFERS = 3;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type Offer = {
  title: string;
  text: string;
  code: string;
  start: string;
  end: string;
};

const parsePlan = (value: unknown) => {
  const number = Number(value);
  return number === 2 || number === 3 ? number : 1;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  try {
    await prisma.shop.upsert({
      where: { domain: session.shop },
      update: {},
      create: { domain: session.shop },
    });
  } catch (error) {
    console.error("Could not save shop", error);
  }
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
        plan: metafield(namespace: "$app", key: "plan") {
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
  const plan = parsePlan(json.data?.shop?.plan?.value);
  return { offers, enabled, plan };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const form = await request.formData();

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

  // One-button