// @ts-nocheck
import '@shopify/ui-extensions/preact';
import {render} from "preact";
import {useState, useEffect} from "preact/hooks";

// The permanent address of your app server.
const APP_URL = "https://clickswap-dev.onrender.com";

// Every tier shows the same number of ad slots.
const SLOTS = 3;

export default async () => {
  render(<Extension />, document.body);
};

// Asks your server for swap ads and your own offers.
// Any problem just means "show nothing".
async function loadContent() {
  try {
    const token = await shopify.sessionToken.get();
    const response = await fetch(`${APP_URL}/api/status-ads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return { ads: [], offers: [] };
    const data = await response.json();
    return {
      ads: Array.isArray(data.ads) ? data.ads.slice(0, SLOTS) : [],
      offers: Array.isArray(data.offers) ? data.offers.slice(0, SLOTS) : [],
    };
  } catch (error) {
    return { ads: [], offers: [] };
  }
}

function Extension() {
  const [content, setContent] = useState(null);

  useEffect(() => {
    loadContent().then(setContent);
  }, []);

  if (!content) return null;

  // Swap ads go first, then your own offers fill any empty slots.
  const items = [
    ...content.ads.map((ad) => ({ ...ad, sponsored: true })),
    ...content.offers,
  ].slice(0, SLOTS);

  if (items.length === 0) return null;

  return (
    <s-stack gap="base">
      {items.map((offer, index) => (
        <s-banner key={index} heading={offer.title}>
          <s-stack gap="base">
            {offer.sponsored ? <s-text>Sponsored</s-text> : null}
            {offer.text ? <s-text>{offer.text}</s-text> : null}
            {offer.code ? (
              <s-text type="emphasis">Code: {offer.code}</s-text>
            ) : null}
            {offer.sponsored && offer.token ? (
              <s-link href={`${APP_URL}/click/${offer.token}`}>Visit store</s-link>
            ) : null}
          </s-stack>
        </s-banner>
      ))}
    </s-stack>
  );
}