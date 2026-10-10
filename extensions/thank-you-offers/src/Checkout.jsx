// @ts-nocheck
import '@shopify/ui-extensions/preact';
import {render} from "preact";
import {useState, useEffect} from "preact/hooks";

// The address of your app server. It changes each time the dev tunnel restarts.
const APP_URL = "https://clickswap-dev.onrender.com";

// Every tier shows the same number of ad slots.
const SLOTS = 3;

const SAMPLE_OFFERS = [
  {
    title: "A thank-you gift for you",
    text: "Use code THANKYOU10 for 10% off your next order.",
    code: "",
  },
];

export default async () => {
  render(<Extension />, document.body);
};

function findEntry(key) {
  return shopify.appMetafields.value.find(
    (item) =>
      item.target.type === "shop" &&
      item.metafield.namespace === "$app" &&
      item.metafield.key === key,
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
    const parsed = JSON.parse(entry.metafield.value);
    if (!Array.isArray(parsed) || parsed.length === 0) return SAMPLE_OFFERS;
    const today = todayString();
    return parsed
      .slice(0, SLOTS)
      .filter((offer) => offer && offer.title)
      .filter((offer) => isActive(offer, today));
  } catch (error) {
    return SAMPLE_OFFERS;
  }
}

// Asks your server for swap ads. Any problem just means "no swap ads".
async function loadSwapAds() {
  try {
    const token = await shopify.sessionToken.get();
    const response = await fetch(`${APP_URL}/api/ad`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data && Array.isArray(data.ads) ? data.ads.slice(0, SLOTS) : [];
  } catch (error) {
    return [];
  }
}

function Extension() {
  const [swapAds, setSwapAds] = useState([]);

  useEffect(() => {
    if (!readEnabled()) return;
    loadSwapAds().then(setSwapAds);
  }, []);

  if (!readEnabled()) return null;

  // Swap ads go first, then your own offers fill any empty slots.
  const own = readOffers();
  const items = [
    ...swapAds.map((ad) => ({ ...ad, sponsored: true })),
    ...own,
  ].slice(0, SLOTS);

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