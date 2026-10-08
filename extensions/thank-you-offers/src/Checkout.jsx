// @ts-nocheck
import '@shopify/ui-extensions/preact';
import {render} from "preact";

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

function Extension() {
  if (!readEnabled()) return null;
  const offers = readOffers();
  if (offers.length === 0) return null;
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