import { useState } from "react";
import { data } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import prisma from "../db.server";

// Reports from this many different stores switch an ad off for everyone.
const AUTO_DISABLE_AT = 3;

const REASONS = [
  "Misleading or false claims",
  "Offensive or inappropriate",
  "Not relevant to my store",
  "Competitor I do not want to show",
  "Broken or unsafe link",
  "Other",
];

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const click = await prisma.click.findUnique({ where: { token: params.token || "" } });
  if (!click) throw data("This report link is not valid.", { status: 404 });
  const ad = await prisma.ad.findUnique({ where: { id: click.adId } });
  return { adTitle: ad ? ad.title : "this ad" };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const click = await prisma.click.findUnique({ where: { token: params.token || "" } });
  if (!click) return data({ ok: false, message: "This report link is not valid." }, { status: 404 });

  const form = await request.formData();
  const reason = String(form.get("reason") || "");
  const note = String(form.get("note") || "").slice(0, 500);
  if (!REASONS.includes(reason)) {
    return data({ ok: false, message: "Please pick a reason." }, { status: 400 });
  }

  // The reporting store is the store whose Thank You page showed the ad.
  const shopId = click.senderShopId;
  const adId = click.adId;

  const already = await prisma.report.findFirst({ where: { shopId, adId } });
  if (!already) {
    await prisma.report.create({
      data: { shopId, adId, reason, note: note || null },
    });

    // Count how many different stores have reported this ad.
    const reports = await prisma.report.findMany({
      where: { adId, status: { not: "dismissed" } },
      select: { shopId: true },
    });
    const different = new Set(reports.map((r) => r.shopId)).size;
    if (different >= AUTO_DISABLE_AT) {
      await prisma.ad.update({
        where: { id: adId },
        data: { disabled: true, disabledReason: "Reported by several stores" },
      });
    }
  }

  return { ok: true, message: "Thank you. This ad is hidden for your store, and we will review it." };
};

export default function ReportPage() {
  const { adTitle } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const [reason, setReason] = useState(REASONS[0]);

  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: 480, margin: "40px auto", padding: 16 }}>
      <h2>Report an ad</h2>
      {result && result.ok ? (
        <p>{result.message}</p>
      ) : (
        <Form method="post">
          <p>You are reporting: <strong>{adTitle}</strong></p>
          {result && !result.ok ? <p style={{ color: "red" }}>{result.message}</p> : null}
          <p>
            <label>
              Reason<br />
              <select name="reason" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: "100%", padding: 8 }}>
                {REASONS.map((r) => (<option key={r} value={r}>{r}</option>))}
              </select>
            </label>
          </p>
          <p>
            <label>
              Anything else? (optional)<br />
              <textarea name="note" rows={3} maxLength={500} style={{ width: "100%", padding: 8 }} />
            </label>
          </p>
          <button type="submit" style={{ padding: "8px 16px" }}>Send report</button>
        </Form>
      )}
    </div>
  );
}