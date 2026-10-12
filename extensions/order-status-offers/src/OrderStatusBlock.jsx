// @ts-nocheck
import '@shopify/ui-extensions/preact';
import {render} from "preact";
import {useState, useEffect} from "preact/hooks";

// The permanent address of your app server.
const APP_URL = "https://clickswap-dev.onrender.com";

// Every tier shows the same number of slots.
const SLOTS = 3;

export default async () => {
  render(<Extension />, document.body);
};

// Asks your server for the store's own products and offers.
// Any problem just means "show nothing".
async function loadContent() {
  try {
    const token = await shopify.sessionToken.get();
    const response = await fetch(`${APP_URL}/api/status-ads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return [];
    const data = await response.json();
    const products = Array.isArray(data.products) ? data.products : [];
    const offers = Array.isArray(data.offers) ? data.offers : [];
    return [
      ...products.map((product) => ({ ...product, isProduct: true })),
      ...offers,
    ].slice(0, SLOTS);
  } catch (error) {
    return [];
  }
}

function Extension() {
  const [items, setItems] = useState(null);

  useEffect(() => {
    loadContent().then(setItems);
  }, []);

  if (!items || items.length === 0) return null;

  return (
    <s-stack gap="base">
      {items.map((item, index) =>
        item.isProduct ? (
          <s-box key={index} border="base" borderRadius="base" padding="base">
            <s-stack gap="small">
              {item.imageUrl ? (
                <s-box maxInlineSize="140px">
                  <s-image src={item.imageUrl} alt={item.title} aspectRatio="1" />
                </s-box>
              ) : null}
              <s-text type="strong">{item.title}</s-text>
              {item.priceText ? <s-text>{item.priceText}</s-text> : null}
              {item.url ? <s-link href={item.url}>View product</s-link> : null}
            </s-stack>
          </s-box>
        ) : (
          <s-banner key={index} heading={item.title}>
            <s-stack gap="base">
              {item.text ? <s-text>{item.text}</s-text> : null}
              {item.code ? (
                <s-text type="emphasis">Code: {item.code}</s-text>
              ) : null}
            </s-stack>
          </s-banner>
        ),
      )}
    </s-stack>
  );
}