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

// Asks your server for the store's own offers.
// Any problem just means "show nothing".
async function loadOffers() {
  try {
    const token = await shopify.sessionToken.get();
    const response = await fetch(`${APP_URL}/api/status-ads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.offers) ? data.offers.slice(0, SLOTS) : [];
  } catch (error) {
    return [];
  }
}

function Extension() {
  const [offers, setOffers] = useState(null);

  useEffect(() => {
    loadOffers().then(setOffers);
  }, []);

  if (!offers || offers.length === 0) return null;

  return (
    <s-stack gap="base">
      {offers.map((offer, index) => (
        <s-banner key={index} heading={offer.title}>
          <s-stack gap="base">
            {offer.text ? <s-text>{offer.text}</s-text> : null}
            {offer.code ? (
              <s-text type="emphasis">Code: {offer.code}</s-text>
            ) : null}
          </s-stack>
        </s-banner>
      ))}
    </s-stack>
  );
}