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

// The order number lets the server show each order the same prize and count one view per order.
function readOrderId() {
  try {
    const id = shopify.orderConfirmation?.value?.order?.id;
    return id ? String(id) : "";
  } catch (error) {
    return "";
  }
}

async function post(path) {
  const token = await shopify.sessionToken.get();
  const response = await fetch(`${APP_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ orderId: readOrderId() }),
  });
  if (!response.ok) return null;
  return response.json();
}

// Asks your server for the 3 slots (partner products and your own products).
// Any problem returns null, and the block falls back to your text offers.
async function loadItems() {
  try {
    const data = await post("/api/ad");
    return data && Array.isArray(data.items) ? data.items.slice(0, SLOTS) : null;
  } catch (error) {
    return null;
  }
}

// Scratch tickets and surprise gifts. Any problem just shows none.
async function loadRewards() {
  try {
    const data = await post("/api/reward");
    return data && Array.isArray(data.rewards) ? data.rewards : [];
  } catch (error) {
    return [];
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

function RewardCard({ reward }) {
  const [revealed, setRevealed] = useState(false);
  const scratch = reward.kind === "scratch";
  return (
    <s-box border="base" borderRadius="base" padding="base">
      <s-stack gap="small">
        <s-text type="strong">{reward.title}</s-text>
        {revealed ? (
          <s-stack gap="small">
            <s-text type="strong">{reward.prize.label}</s-text>
            {reward.prize.code ? (
              <s-text type="emphasis">Your code: {reward.prize.code}</s-text>
            ) : null}
            <s-text>Use it on your next order.</s-text>
          </s-stack>
        ) : (
          <s-stack gap="small">
            <s-text>
              {scratch
                ? "You have a scratch ticket. Scratch it to see what you won."
                : "You have a surprise gift waiting for you."}
            </s-text>
            <s-button onClick={() => setRevealed(true)}>
              {scratch ? "Scratch to reveal" : "Open your gift"}
            </s-button>
          </s-stack>
        )}
      </s-stack>
    </s-box>
  );
}

function Extension() {
  const [items, setItems] = useState(undefined);
  const [rewards, setRewards] = useState([]);

  useEffect(() => {
    if (!readEnabled()) return;
    loadItems().then(setItems);
    loadRewards().then(setRewards);
  }, []);

  if (!readEnabled()) return null;
  // Wait for the server so the slots do not jump around
  if (items === undefined) return null;

  const rewardCards = rewards.map((reward) => (
    <RewardCard key={reward.id} reward={reward} />
  ));

  // If the server has nothing, show the store's own text offers
  if (!items || items.length === 0) {
    return (
      <s-stack gap="base">
        {rewardCards}
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
      {rewardCards}
      {items.map((item, index) => (
        <Card key={index} item={item} />
      ))}
    </s-stack>
  );
}