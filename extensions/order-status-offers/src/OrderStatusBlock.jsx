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

function readOrderId() {
  try {
    const id = shopify.order?.value?.id;
    return id ? String(id) : "";
  } catch (error) {
    return "";
  }
}

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

// Scratch tickets and surprise gifts.
// TEMPORARY: also returns a debug line so we can see why nothing shows.
async function loadRewards() {
  const hasOrder = readOrderId() ? "yes" : "NO";
  try {
    const token = await shopify.sessionToken.get();
    const response = await fetch(`${APP_URL}/api/status-reward`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ orderId: readOrderId() }),
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        rewards: [],
        debug: `order id: ${hasOrder}, server said ${response.status} ${text.slice(0, 80)}`,
      };
    }
    const data = JSON.parse(text);
    const list = data && Array.isArray(data.rewards) ? data.rewards : [];
    return { rewards: list, debug: `order id: ${hasOrder}, server ok, rewards: ${list.length}` };
  } catch (error) {
    return {
      rewards: [],
      debug: `order id: ${hasOrder}, error: ${String(error).slice(0, 100)}`,
    };
  }
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
  const [items, setItems] = useState(null);
  const [rewards, setRewards] = useState([]);
  const [debug, setDebug] = useState("");

  useEffect(() => {
    loadContent().then(setItems);
    loadRewards().then((result) => {
      setRewards(result.rewards);
      setDebug(result.debug);
    });
  }, []);

  const list = items || [];
  if (list.length === 0 && rewards.length === 0 && !debug) return null;

  return (
    <s-stack gap="base">
      {debug ? <s-text>Debug: {debug}</s-text> : null}
      {rewards.map((reward) => (
        <RewardCard key={reward.id} reward={reward} />
      ))}
      {list.map((item, index) =>
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