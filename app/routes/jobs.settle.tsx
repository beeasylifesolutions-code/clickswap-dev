import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import { settleClicks } from "../settle.server";

function isAllowed(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!isAllowed(request)) {
    return new Response("Not allowed", { status: 401 });
  }
  const result = await settleClicks();
  return Response.json(result);
};