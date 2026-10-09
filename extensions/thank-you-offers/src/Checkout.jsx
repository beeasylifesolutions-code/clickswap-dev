// @ts-nocheck
import '@shopify/ui-extensions/preact';
import {render} from "preact";
import {useState, useEffect} from "preact/hooks";

// Leave empty to call your own app's address (relative URL).
const APP_URL = "https://idea-mba-advanced-tourism.trycloudflare.com";

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

function readPlan() {
  const entry = findEntry("plan");
  if (!entry) return 1;
  const number = Number(entry.metafield.value);
  return number === 2 || number === 3 ? number : 1;
}

function readOffers() {
  const entry = findEntry("offers");
  if (!entry) return SAMPLE_OFFERS;
  try {
    const parsed = JSON.parse(entry.metafield.value);
    if (!Array.isArray(parsed) || parsed.length === 0) return SAMPLE_OFFERS;
    const today = todayString();
    return parsed
      .slice(0, readPlan())
      .filter((offer) => offer && offer.title)
      .filter((offer) => isActive(offer, today));
  } catch (error) {
    return SAMPLE_OFFERS;
  }
}

// Asks your server for a swap ad. Any problem just means "no swap ad".
async function loadSwapAd() {
  try {
    const token = await shopify.sessionToken.get();
    const response = await fetch(`${APP_URL}/api/ad`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      return { ad: null, debug: "server said " + response.status };
    }
    const data = await response.json();
    const ad = data && data.ad ? data.ad : null;
    return { ad, debug: ad ? "ad found" : "server sent no ad" };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    return { ad: null, debug: "failed: " + message };
  }
}

function Extension() {
  const [swapAd, setSwapAd] = useState(null);
  const [debug, setDebug] = useState("waiting");

  useEffect(() => {
    if (!readEnabled()) return;
    loadSwapAd().then((result) => {
      setSwapAd(result.ad);
      setDebug(result.debug);
    });
  }, []);

  if (!readEnabled()) return null;

  const slots = readPlan();
  const own = readOffers();
  const items = swapAd
    ? [{ ...swapAd, sponsored: true }, ...own].slice(0, slots)
    : own;

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