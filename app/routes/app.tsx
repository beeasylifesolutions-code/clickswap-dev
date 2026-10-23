import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  Outlet,
  isRouteErrorResponse,
  useLoaderData,
  useLocation,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { PAGE_HELP } from "../help";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const location = useLocation();
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const topic = PAGE_HELP.find((item) => item.path === path);

  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/slots">Slots</s-link>
        <s-link href="/app/rewards">Rewards</s-link>
        <s-link href="/app/survey">Survey</s-link>
        <s-link href="/app/dashboard">Dashboard</s-link>
        <s-link href="/app/swap">Swap ads</s-link>
        <s-link href="/app/partners">Partners</s-link>
        <s-link href="/app/circles">Circles</s-link>
        <s-link href="/app/safety">Safety</s-link>
        <s-link href="/app/help">Help</s-link>
      </s-app-nav>
      {topic ? (
        <div style={{ margin: "12px 16px 0" }}>
          <details
            style={{
              border: "1px solid #c9c9c9",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>
              How this page works
            </summary>
            <p style={{ margin: "8px 0 4px" }}>{topic.summary}</p>
            <ul style={{ margin: "4px 0", paddingLeft: 20 }}>
              {topic.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <s-link href="/app/help">Open the full Help page</s-link>
          </details>
        </div>
      ) : null}
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses (sign-in
// redirects and so on), so those still go through Shopify's own handler.
// Any other crash shows a friendly message instead of a blank screen.
export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return boundary.error(error);
  }

  console.error(error);

  return (
    <div
      style={{
        maxWidth: 520,
        margin: "64px auto",
        padding: "0 20px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        lineHeight: 1.6,
        color: "#1a1a1a",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: 22 }}>Something went wrong</h1>
      <p>
        PostSwap could not load this page. Your store and your shoppers are not
        affected: your Thank You page keeps working. Please try again in a
        moment.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          padding: "10px 18px",
          fontSize: 15,
          borderRadius: 8,
          border: "1px solid #1a1a1a",
          background: "#1a1a1a",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        Reload
      </button>
      <p style={{ marginTop: 24, fontSize: 14, color: "#616161" }}>
        Still stuck? Email beeasylifesolutions@gmail.com.
      </p>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};