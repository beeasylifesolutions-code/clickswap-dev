import { createHash, timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData } from "react-router";
import prisma from "../db.server";

const COOKIE = "ps_operator";

export const meta = () => [
  { title: "PostSwap operator" },
  { name: "robots", content: "noindex" },
];

function hashOf(value: string) {
  return createHash("sha256").update(`postswap-operator:${value}`).digest("hex");
}

// The expected cookie value, or null when no usable key is set on the server
function expectedToken() {
  // eslint-disable-next-line no-undef
  const key = process.env.OPERATOR_KEY;
  if (!key || key.length < 20) return null;
  return hashOf(key);
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isAuthed(request: Request) {
  const expected = expectedToken();
  if (!expected) return false;
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]+)`));
  return Boolean(match && safeEqual(match[1], expected));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const configured = expectedToken() !== null;
  if (!isAuthed(request)) {
    return { authed: false, configured, reports: [], shops: [], disabledAds: [] };
  }

  const reports = await prisma.report.findMany({
    where: { status: "open" },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { shop: true, ad: { include: { shop: true } } },
  });
  const shops = await prisma.shop.findMany({
    orderBy: { domain: "asc" },
    take: 200,
  });
  const disabledAds = await prisma.ad.findMany({
    where: { disabled: true },
    include: { shop: true },
    take: 100,
  });

  return {
    authed: true,
    configured,
    reports: reports.map((report) => ({
      id: report.id,
      adId: report.adId,
      adTitle: report.ad.title,
      adDisabled: report.ad.disabled,
      advertiserId: report.ad.shopId,
      advertiser: report.ad.shop.domain,
      reporter: report.shop.domain,
      reason: report.reason,
      note: report.note ?? "",
      when: report.createdAt.toISOString().slice(0, 16).replace("T", " "),
    })),
    shops: shops.map((shop) => ({
      id: shop.id,
      domain: shop.domain,
      suspended: shop.suspended,
      suspendedReason: shop.suspendedReason ?? "",
      swapEnabled: shop.swapEnabled,
    })),
    disabledAds: disabledAds.map((ad) => ({
      id: ad.id,
      title: ad.title,
      advertiser: ad.shop.domain,
      reason: ad.disabledReason ?? "",
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "login") {
    const expected = expectedToken();
    const given = hashOf(String(form.get("key") || ""));
    if (!expected || !safeEqual(given, expected)) {
      return { error: "That key is not right." };
    }
    return redirect("/operator", {
      headers: {
        "Set-Cookie": `${COOKIE}=${expected}; Path=/operator; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`,
      },
    });
  }

  if (intent === "logout") {
    return redirect("/operator", {
      headers: {
        "Set-Cookie": `${COOKIE}=; Path=/operator; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
      },
    });
  }

  if (!isAuthed(request)) return { error: "Please log in first." };

  const now = new Date();
  const adId = String(form.get("adId") || "");
  const shopId = String(form.get("shopId") || "");
  const reportId = String(form.get("reportId") || "");

  if (intent === "disableAd" && adId) {
    await prisma.ad.update({
      where: { id: adId },
      data: { disabled: true, disabledReason: "Switched off by PostSwap review" },
    });
    await prisma.report.updateMany({
      where: { adId, status: "open" },
      data: { status: "actioned", reviewedAt: now },
    });
  } else if (intent === "enableAd" && adId) {
    await prisma.ad.update({
      where: { id: adId },
      data: { disabled: false, disabledReason: null },
    });
  } else if (intent === "dismiss" && reportId) {
    await prisma.report.update({
      where: { id: reportId },
      data: { status: "dismissed", reviewedAt: now },
    });
  } else if (intent === "suspendShop" && shopId) {
    await prisma.shop.update({
      where: { id: shopId },
      data: { suspended: true, suspendedReason: "Suspended by PostSwap review" },
    });
  } else if (intent === "unsuspendShop" && shopId) {
    await prisma.shop.update({
      where: { id: shopId },
      data: { suspended: false, suspendedReason: null },
    });
  }
  return { error: "" };
};

const box = {
  border: "1px solid #ccc",
  borderRadius: 8,
  padding: 12,
  marginBottom: 12,
} as const;

function Button({
  fields,
  label,
}: {
  fields: Record<string, string>;
  label: string;
}) {
  return (
    <Form method="post" style={{ display: "inline-block", marginRight: 8 }}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" style={{ padding: "6px 12px" }}>
        {label}
      </button>
    </Form>
  );
}

export default function Operator() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();

  return (
    <div
      style={{
        fontFamily: "sans-serif",
        maxWidth: 900,
        margin: "24px auto",
        padding: 16,
      }}
    >
      <h1>PostSwap operator</h1>

      {!data.authed ? (
        data.configured ? (
          <Form method="post">
            <input type="hidden" name="intent" value="login" />
            <p>
              <label>
                Operator key
                <br />
                <input
                  type="password"
                  name="key"
                  autoComplete="off"
                  style={{ padding: 8, width: 320 }}
                />
              </label>
            </p>
            {result && "error" in result && result.error ? (
              <p style={{ color: "red" }}>{result.error}</p>
            ) : null}
            <button type="submit" style={{ padding: "8px 16px" }}>
              Log in
            </button>
          </Form>
        ) : (
          <p>
            The operator key is not set on the server yet (it must be at least
            20 characters).
          </p>
        )
      ) : (
        <>
          <Button fields={{ intent: "logout" }} label="Log out" />

          <h2>Open reports ({data.reports.length})</h2>
          {data.reports.length === 0 ? <p>No open reports.</p> : null}
          {data.reports.map((report) => (
            <div key={report.id} style={box}>
              <strong>{report.adTitle}</strong> from {report.advertiser}
              <br />
              Reported by {report.reporter} on {report.when} UTC
              <br />
              Reason: {report.reason}
              {report.note ? <> / Note: {report.note}</> : null}
              <br />
              {report.adDisabled ? <em>Ad is already switched off. </em> : null}
              <div style={{ marginTop: 8 }}>
                {!report.adDisabled ? (
                  <Button
                    fields={{ intent: "disableAd", adId: report.adId }}
                    label="Switch this ad off"
                  />
                ) : null}
                <Button
                  fields={{ intent: "dismiss", reportId: report.id }}
                  label="Dismiss report"
                />
                <Button
                  fields={{
                    intent: "suspendShop",
                    shopId: report.advertiserId,
                  }}
                  label="Suspend the advertiser store"
                />
              </div>
            </div>
          ))}

          <h2>Switched-off ads ({data.disabledAds.length})</h2>
          {data.disabledAds.length === 0 ? <p>None.</p> : null}
          {data.disabledAds.map((ad) => (
            <div key={ad.id} style={box}>
              <strong>{ad.title}</strong> from {ad.advertiser}
              {ad.reason ? <> ({ad.reason})</> : null}
              <div style={{ marginTop: 8 }}>
                <Button
                  fields={{ intent: "enableAd", adId: ad.id }}
                  label="Switch back on"
                />
              </div>
            </div>
          ))}

          <h2>Stores ({data.shops.length})</h2>
          {data.shops.map((shop) => (
            <div key={shop.id} style={box}>
              <strong>{shop.domain}</strong>
              {" - "}
              {shop.suspended
                ? `Suspended${shop.suspendedReason ? ` (${shop.suspendedReason})` : ""}`
                : shop.swapEnabled
                  ? "Swap on"
                  : "Swap off"}
              <div style={{ marginTop: 8 }}>
                {shop.suspended ? (
                  <Button
                    fields={{ intent: "unsuspendShop", shopId: shop.id }}
                    label="Restore store"
                  />
                ) : (
                  <Button
                    fields={{ intent: "suspendShop", shopId: shop.id }}
                    label="Suspend store"
                  />
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}