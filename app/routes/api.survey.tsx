import { createHash } from "crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { domainOf } from "../rewards.server";

// Only the final number of the order id is used, so the key is the same however the id is written
function orderNumber(orderId: string): string {
  const runs = String(orderId || "").match(/\d+/g);
  return runs ? runs[runs.length - 1] : "";
}

const handle = async (request: Request) => {
  const { sessionToken, cors } = await authenticate.public.checkout(request);
  const domain = domainOf(sessionToken.dest);

  let orderId = "";
  let answer = "";
  try {
    const body = await request.json();
    orderId = String(body?.orderId ?? "");
    answer = String(body?.answer ?? "");
  } catch {
    orderId = "";
    answer = "";
  }

  const number = orderNumber(orderId);
  const shop = await prisma.shop.findUnique({ where: { domain } });
  const flags = shop as unknown as {
    killSwitch?: boolean;
    suspended?: boolean;
  } | null;

  if (!shop || !number || flags?.killSwitch === true || flags?.suspended === true) {
    return cors(Response.json({ survey: null }));
  }

  const survey = await prisma.survey.findUnique({
    where: { shopId: shop.id },
  });
  if (!survey || !survey.active) {
    return cors(Response.json({ survey: null }));
  }

  // Anonymous: only a one-way hash of the order is kept, so each order answers once
  const orderKey = createHash("sha256")
    .update(`${shop.id}:survey:${number}`)
    .digest("hex");

  const existing = await prisma.surveyAnswer.findUnique({
    where: { surveyId_orderKey: { surveyId: survey.id, orderKey } },
  });

  // The shopper tapped an answer
  if (answer) {
    if (!survey.options.includes(answer)) {
      return cors(Response.json({ ok: false }, { status: 400 }));
    }
    if (!existing) {
      try {
        await prisma.surveyAnswer.create({
          data: {
            surveyId: survey.id,
            orderKey,
            question: survey.question,
            answer,
          },
        });
      } catch {
        // Already answered a moment ago: that is fine
      }
    }
    return cors(Response.json({ ok: true }));
  }

  // The page is asking whether to show the question
  if (existing) {
    return cors(Response.json({ survey: null }));
  }
  return cors(
    Response.json({
      survey: { question: survey.question, options: survey.options },
    }),
  );
};

export const action = async ({ request }: ActionFunctionArgs) => handle(request);
export const loader = async ({ request }: LoaderFunctionArgs) => handle(request);