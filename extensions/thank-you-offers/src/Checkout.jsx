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
    if (!Array.isArray(parsed)) return SAMPLE_OFFERS;
    const valid = parsed.filter((offer) => offer && offer.title).slice(0, 3);
    return valid.length > 0 ? valid : SAMPLE_OFFERS;
  } catch (error) {
    return SAMPLE_OFFERS;
  }
}

function Extension() {
  if (!readEnabled()) return null;
  const offers = readOffers();
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