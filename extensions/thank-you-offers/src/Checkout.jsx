// @ts-nocheck
import '@shopify/ui-extensions/preact';
import {render} from "preact";
import {useState, useEffect} from "preact/hooks";

// The address of your app server.
const APP_URL = "https://clickswap-dev.onrender.com";

// Every tier shows the same number of slots.
const SLOTS = 3;

const SAMPLE_OFFERS = [
  { title: "A thank-you gift for you", text: "Use code THANKYOU10 for 10% off your next order.", code: "" },
];

export default async () => { render(<Extension />, document.body); };

function findEntry(key) {
  return shopify.appMetafields.value.find(
    (item) => item.target.type === "shop" && item.metafield.namespace === "$app" && item.metafield.key === key
  );
}

function todayString() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function isActive(offer, today) {
  if (offer.start && offer.start > today) return false;
  if (offer.end && offer.end < today) return false;
  return true;
}

function readEnabled() {
  const entry = findEntry("enabled");
  if (!entry) return true;
  return String(entry.metafield.value) !== "false";
}

function readOffers() {
  const entry = findEntry("offers");
  if (!entry) return SAMPLE_OFFERS;
  try {
    const parsed = JSON.parse(String(entry.metafield.value));
    if (!Array.isArray(parsed)) return SAMPLE_OFFERS;
    const today = todayString();
    const offers = parsed
      .slice(0, SLOTS)
      .filter((offer) => offer && offer.title)
      .filter((offer) => isActive(offer, today));
    return offers.length > 0 ? offers : SAMPLE_OFFERS;
  } catch (error) {
    return SAMPLE_OFFERS;
  }
}

// Asks your server for the 3 slots (partner products and your own products).
// Any problem returns null, and the block falls back to your text offers.
async function loadItems() {
  try {
    const token = await shopify.sessionToken.get();
    const response = await fetch(`${APP_URL}/api/ad`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data && Array.isArray(data.items) ? data.items.slice(0, SLOTS) : null;
  } catch (error) {
    return null;
  }
}

function Card({ item }) {
  const partner = item.kind === "partner";
  return (
    <s-box border="base" borderRadius="base" padding="base">
      <s-stack gap="small">
        {partner ? <s-text>Sponsored</s-text> : null}
        {item.imageUrl ? (
          <s-box maxInlineSize="140px">
            <s-image src={item.imageUrl} alt={item.title} aspectRatio="1" />
          </s-box>
        ) : null}
        <s-text type="strong">{item.title}</s-text>
        {item.priceText ? <s-text>{item.priceText}</s-text> : null}
        {item.text ? <s-text>{item.text}</s-text> : null}
        {item.code ? (<s-text type="emphasis">Code: {item.code}</s-text>) : null}
        {partner && item.token ? (
          <s-stack direction="inline" gap="base">
            <s-link href={`${APP_URL}/click/${item.token}`}>Visit store</s-link>
            <s-link href={`${APP_URL}/report/${item.token}`}>Report</s-link>
          </s-stack>
        ) : null}
        {!partner && item.url ? (
          <s-link href={item.url}>View product</s-link>
        ) : null}
      </s-stack>
    </s-box>
  );
}

function Extension() {
  const [items, setItems] = useState(undefined);

  useEffect(() => {
    if (!readEnabled()) return;
    loadItems().then(setItems);
  }, []);

  if (!readEnabled()) return null;
  // Wait for the server so the slots do not jump around
  if (items === undefined) return null;

  // If the server has nothing, show the store's own text offers
  if (!items || items.length === 0) {
    return (
      <s-stack gap="base">
        {readOffers().map((offer, index) => (
          <s-banner key={index} heading={offer.title}>
            <s-stack gap="base">
              {offer.text ? <s-text>{offer.text}</s-text> : null}
              {offer.code ? (<s-text type="emphasis">Code: {offer.code}</s-text>) : null}
            </s-stack>
          </s-banner>
        ))}
      </s-stack>
    );
  }

  return (
    <s-stack gap="base">
      {items.map((item, index) => (
        <Card key={index} item={item} />
      ))}
    </s-stack>
  );
}