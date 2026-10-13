import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";

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
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const old = await prisma.click.deleteMany({
    where: { status: "pending", createdAt: { lt: cutoff } },
  });
  return Response.json({ deletedPendingClicks: old.count });
};