import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { domainOf, rewardsForOrder } from "../rewards.server";

const handle = async (request: Request) => {
  const { sessionToken, cors } =
    await authenticate.public.customerAccount(request);

  let orderId = "";
  try {
    const body = await request.json();
    orderId = String(body?.orderId ?? "");
  } catch {
    orderId = "";
  }

  const rewards = await rewardsForOrder(domainOf(sessionToken.dest), orderId);
  return cors(Response.json({ rewards }));
};

export const action = async ({ request }: ActionFunctionArgs) => handle(request);
export const loader = async ({ request }: LoaderFunctionArgs) => handle(request);