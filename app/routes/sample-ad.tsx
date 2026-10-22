export const meta = () => [{ title: "Sample partner ad - PostSwap" }];

export default function SampleAd() {
  return (
    <main
      style={{
        maxWidth: 640,
        margin: "0 auto",
        padding: "48px 20px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        lineHeight: 1.6,
        color: "#1a1a1a",
      }}
    >
      <h1>This is a sample partner ad</h1>
      <p>
        You clicked the sample ad that PostSwap shows on development (test)
        stores. On a live store, this card would be a real product from a
        partner store, marked Sponsored, and the click would take the shopper to
        that partner&apos;s store.
      </p>
      <p>
        No credits moved and no other store was involved. Real partner ads only
        appear on live stores that meet the order minimum.
      </p>
    </main>
  );
}