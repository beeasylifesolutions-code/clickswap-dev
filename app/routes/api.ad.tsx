import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { pickSwapAds } from "../swapads.server";

// Handles the "preflight" check Shopify sends before the real request
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.checkout(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { cors, sessionToken } = await authenticate.public.checkout(request);
  const domain = String(sessionToken.dest).replace(/^https?:\/\//, "");
  const ads = await pickSwapAds(domain);
  return cors(Response.json({ ads }));
};